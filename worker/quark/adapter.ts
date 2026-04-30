import { QuarkClient } from './client'
import type { QuarkDirectoryListing, QuarkDownloadLink, QuarkEntry, QuarkResolvedPath } from './types'

const ROOT_FID = '0'
const DIRECTORY_CACHE_TTL_MS = 20_000
const PATH_CACHE_TTL_MS = 20_000
const NEGATIVE_PATH_CACHE_TTL_MS = 5_000
const DOWNLOAD_URL_FALLBACK_TTL_MS = 20_000
const DOWNLOAD_URL_EXPIRY_BUFFER_MS = 60_000

type CacheEntry<T> = {
  value: T
  expiresAt: number
}

type ResolvedPathCacheValue = QuarkResolvedPath | null

const directoryCache = new Map<string, CacheEntry<QuarkEntry[]>>()
const pathCache = new Map<string, CacheEntry<ResolvedPathCacheValue>>()
const downloadUrlCache = new Map<string, CacheEntry<QuarkDownloadLink>>()

export class QuarkAdapter {
  private readonly client: QuarkClient
  private readonly cacheKeyPrefix: string

  constructor(cookie: string, onCookiesUpdated?: (cookieUpdates: string[]) => void) {
    this.client = new QuarkClient(cookie, onCookiesUpdated)
    this.cacheKeyPrefix = createCookieFingerprint(cookie)
  }

  async listPath(pathname: string): Promise<QuarkDirectoryListing> {
    if (pathname === '/') {
      const entries = await this.listDirectoryCached(ROOT_FID)
      return {
        parentFid: ROOT_FID,
        entries,
      }
    }

    const resolved = await this.resolvePath(pathname)
    if (!resolved) {
      throw new Error('Requested Quark path was not found.')
    }

    if (!resolved.entry.isDirectory) {
      return {
        parentFid: resolved.entry.parentFid,
        entries: [resolved.entry],
      }
    }

    const entries = await this.listDirectoryCached(resolved.entry.fid)
    return {
      parentFid: resolved.entry.fid,
      entries,
    }
  }

  async statPath(pathname: string): Promise<QuarkResolvedPath | null> {
    if (pathname === '/') {
      return {
        path: '/',
        entry: {
          fid: ROOT_FID,
          parentFid: '',
          name: '',
          isDirectory: true,
          size: 0,
          contentType: 'httpd/unix-directory',
        },
      }
    }

    return this.resolvePath(pathname)
  }

  async getDownloadUrl(
    pathname: string,
    options?: { forceRefresh?: boolean },
  ): Promise<{ entry: QuarkEntry; downloadUrl: string }> {
    const resolved = await this.resolvePath(pathname)
    if (!resolved) {
      throw new Error('Requested Quark path was not found.')
    }

    if (resolved.entry.isDirectory) {
      throw new Error('Directories do not have downloadable content.')
    }

    return {
      entry: resolved.entry,
      downloadUrl: await this.getDownloadUrlCached(resolved.entry.fid, options?.forceRefresh === true),
    }
  }

  private async resolvePath(pathname: string): Promise<QuarkResolvedPath | null> {
    const normalizedPath = normalizePath(pathname)
    const cachedPath = this.getCachedPath(normalizedPath)
    if (cachedPath !== undefined) {
      return cachedPath
    }

    const segments = normalizedPath.split('/').filter(Boolean).map(decodeURIComponent)
    if (segments.length === 0) {
      const root = {
        path: '/',
        entry: {
          fid: ROOT_FID,
          parentFid: '',
          name: '',
          isDirectory: true,
          size: 0,
          contentType: 'httpd/unix-directory',
        },
      }

      this.setCachedPath('/', root, PATH_CACHE_TTL_MS)
      return root
    }

    let parentFid = ROOT_FID
    let currentPath = ''
    let currentEntry: QuarkEntry | null = null

    for (const segment of segments) {
      const entries = await this.listDirectoryCached(parentFid)
      const nextEntry = entries.find((entry) => entry.name === segment)
      if (!nextEntry) {
        this.setCachedPath(normalizedPath, null, NEGATIVE_PATH_CACHE_TTL_MS)
        return null
      }

      currentPath += `/${segment}`
      currentEntry = nextEntry
      parentFid = nextEntry.fid
    }

    if (!currentEntry) {
      this.setCachedPath(normalizedPath, null, NEGATIVE_PATH_CACHE_TTL_MS)
      return null
    }

    const resolved = {
      path: currentPath,
      entry: currentEntry,
    }

    this.setCachedPath(normalizedPath, resolved, PATH_CACHE_TTL_MS)
    return resolved
  }

  private async listDirectoryCached(parentFid: string): Promise<QuarkEntry[]> {
    const cacheKey = `${this.cacheKeyPrefix}:dir:${parentFid}`
    const cached = getCachedValue(directoryCache, cacheKey)
    if (cached) {
      return cached
    }

    const entries = await this.client.listDirectory(parentFid)
    setCachedValue(directoryCache, cacheKey, entries, DIRECTORY_CACHE_TTL_MS)
    return entries
  }

  private async getDownloadUrlCached(fid: string, forceRefresh: boolean): Promise<string> {
    const cacheKey = `${this.cacheKeyPrefix}:download:${fid}`
    if (!forceRefresh) {
      const cached = getCachedValue(downloadUrlCache, cacheKey)
      if (cached && !isDownloadLinkExpired(cached)) {
        return cached.url
      }
    }

    const nextLink = await this.client.getDownloadUrl(fid)
    const ttl = getDownloadLinkTtl(nextLink)
    setCachedValue(downloadUrlCache, cacheKey, nextLink, ttl)
    return nextLink.url
  }

  private getCachedPath(pathname: string): ResolvedPathCacheValue | undefined {
    const cacheKey = `${this.cacheKeyPrefix}:path:${pathname}`
    const entry = pathCache.get(cacheKey)
    if (!entry) {
      return undefined
    }

    if (entry.expiresAt <= Date.now()) {
      pathCache.delete(cacheKey)
      return undefined
    }

    return entry.value
  }

  private setCachedPath(pathname: string, value: ResolvedPathCacheValue, ttlMs: number): void {
    const cacheKey = `${this.cacheKeyPrefix}:path:${pathname}`
    setCachedValue(pathCache, cacheKey, value, ttlMs)
  }
}

function createCookieFingerprint(cookie: string): string {
  let hash = 0
  for (let index = 0; index < cookie.length; index += 1) {
    hash = (hash * 31 + cookie.charCodeAt(index)) >>> 0
  }

  return hash.toString(16)
}

function normalizePath(pathname: string): string {
  if (pathname === '' || pathname === '/') {
    return '/'
  }

  const normalized = pathname.replace(/\/+/g, '/').replace(/\/$/, '')
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key)
  if (!entry) {
    return null
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }

  return entry.value
}

function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  })
}

function isDownloadLinkExpired(link: QuarkDownloadLink): boolean {
  if (!link.expiresAt) {
    return false
  }

  return link.expiresAt - Date.now() <= DOWNLOAD_URL_EXPIRY_BUFFER_MS
}

function getDownloadLinkTtl(link: QuarkDownloadLink): number {
  if (!link.expiresAt) {
    return DOWNLOAD_URL_FALLBACK_TTL_MS
  }

  return Math.max(1_000, link.expiresAt - Date.now())
}
