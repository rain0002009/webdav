import { QuarkAdapter } from './quark/adapter'
import { QuarkApiError, type QuarkEntry } from './quark/types'
import {
  getPersistedQuarkSessionByAccountKey,
  getWebDavCredentialsByUsername,
  mergeCookieString,
  persistQuarkSessionForAccount,
  setDriveConnectionState,
} from './session-store'

const DAV_HEADERS = {
  DAV: '1',
  Allow: 'OPTIONS, PROPFIND, GET, HEAD',
  'MS-Author-Via': 'DAV',
  'Cache-Control': 'no-store',
} satisfies HeadersInit

export async function handleWebDavRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const auth = parseBasicAuth(request)
  if (!auth.ok) {
    return new Response(auth.message, {
      status: 401,
      headers: {
        ...DAV_HEADERS,
        'content-type': 'text/plain; charset=utf-8',
        'www-authenticate': 'Basic realm="Quark WebDAV"',
      },
    })
  }

  const credentials = await getWebDavCredentialsByUsername(auth.username, env)
  if (!credentials || !constantTimeEquals(auth.password, credentials.password)) {
    return new Response('Invalid WebDAV username or password.', {
      status: 401,
      headers: {
        ...DAV_HEADERS,
        'content-type': 'text/plain; charset=utf-8',
        'www-authenticate': 'Basic realm="Quark WebDAV"',
      },
    })
  }

  const persistedSession = await getPersistedQuarkSessionByAccountKey(credentials.accountKey, env)
  if (!persistedSession?.cookie) {
    return new Response('No bound Quark session is available for this WebDAV account.', {
      status: 401,
      headers: {
        ...DAV_HEADERS,
        'content-type': 'text/plain; charset=utf-8',
        'www-authenticate': 'Basic realm="Quark WebDAV"',
      },
    })
  }

  let accountCookie = persistedSession.cookie

  const adapter = new QuarkAdapter(accountCookie, async (cookieUpdates) => {
    const mergedCookie = mergeCookieString(accountCookie, cookieUpdates)
    if (!mergedCookie) {
      return
    }

    accountCookie = mergedCookie
    await persistQuarkSessionForAccount(
      credentials.accountKey,
      mergedCookie,
      {
        user: persistedSession.user,
        expiresAt: persistedSession.expiresAt,
      },
      env,
    )
  })

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: DAV_HEADERS,
    })
  }

  if (request.method === 'PROPFIND') {
    return handlePropfind(adapter, url, request)
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    return handleGet(adapter, url, request, persistedSession.user)
  }

  return new Response('WebDAV write operations are not implemented in this MVP.', {
    status: 501,
    headers: {
      ...DAV_HEADERS,
      'content-type': 'text/plain; charset=utf-8',
    },
  })
}

async function handlePropfind(adapter: QuarkAdapter, url: URL, request: Request): Promise<Response> {
  const pathname = normalizeDavPath(url.pathname)
  const depth = request.headers.get('depth') ?? '0'

  try {
    const listing = await adapter.listPath(pathname)
    const target = await adapter.statPath(pathname)
    if (!target) {
      return notFoundResponse('Requested DAV resource was not found in Quark.')
    }

    setDriveConnectionState({
      driveReady: true,
      driveStatus: 'Quark upstream read bridge is connected.',
    })

    const responses = [createPropfindResponse(pathname, target.entry)]
    if (target.entry.isDirectory && depth !== '0') {
      for (const entry of listing.entries) {
        responses.push(createPropfindResponse(joinDavPath(pathname, entry.name), entry))
      }
    }

    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
${responses.join('\n')}
</D:multistatus>`

    return new Response(xml, {
      status: 207,
      headers: {
        ...DAV_HEADERS,
        'content-type': 'application/xml; charset=utf-8',
      },
    })
  } catch (error) {
    return handleQuarkError(error)
  }
}

async function handleGet(
  adapter: QuarkAdapter,
  url: URL,
  request: Request,
  user?: string,
): Promise<Response> {
  const pathname = normalizeDavPath(url.pathname)

  try {
    const target = await adapter.statPath(pathname)
    if (!target) {
      return notFoundResponse('Requested DAV resource was not found in Quark.')
    }

    setDriveConnectionState({
      driveReady: true,
      driveStatus: 'Quark upstream read bridge is connected.',
    })

    if (target.entry.isDirectory) {
      const listing = await adapter.listPath(pathname)
      const body = [
        `Quark directory listing for ${pathname}`,
        `Authenticated session hint: ${user ?? 'unknown-user'}`,
        '',
        ...listing.entries.map((entry) => `${entry.isDirectory ? '[DIR]' : '[FILE]'} ${entry.name}`),
      ].join('\n')

      return new Response(request.method === 'HEAD' ? null : body, {
        status: 200,
        headers: {
          ...DAV_HEADERS,
          'content-type': 'text/plain; charset=utf-8',
        },
      })
    }

    if (request.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: {
          ...DAV_HEADERS,
          'content-type': target.entry.contentType ?? 'application/octet-stream',
          'content-length': String(target.entry.size),
          'last-modified': toHttpDate(target.entry.updatedAt),
        },
      })
    }

    const { entry, downloadUrl } = await adapter.getDownloadUrl(pathname)
    let upstreamResponse = await fetch(downloadUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: createRangeHeaders(request),
    })

    if (isExpiredDownloadResponse(upstreamResponse.status)) {
      const refreshed = await adapter.getDownloadUrl(pathname, { forceRefresh: true })
      upstreamResponse = await fetch(refreshed.downloadUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: createRangeHeaders(request),
      })
    }

    if (!upstreamResponse.ok) {
      setDriveConnectionState({
        driveReady: false,
        driveStatus: 'Quark upstream returned an error while streaming file content.',
        error: `upstream-download-${upstreamResponse.status}`,
      })

      return new Response(`Quark upstream download failed (${upstreamResponse.status}).`, {
        status: 502,
        headers: {
          ...DAV_HEADERS,
          'content-type': 'text/plain; charset=utf-8',
        },
      })
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: {
        ...DAV_HEADERS,
        'content-type': upstreamResponse.headers.get('content-type') ?? entry.contentType ?? 'application/octet-stream',
        'content-length': upstreamResponse.headers.get('content-length') ?? String(entry.size),
        'last-modified': upstreamResponse.headers.get('last-modified') ?? toHttpDate(entry.updatedAt),
        ...(upstreamResponse.headers.get('content-range')
          ? { 'content-range': upstreamResponse.headers.get('content-range') ?? '' }
          : {}),
      },
    })
  } catch (error) {
    return handleQuarkError(error)
  }
}

function normalizeDavPath(pathname: string): string {
  const value = pathname.replace(/^\/dav/, '')
  return value === '' ? '/' : value
}

function createPropfindResponse(pathname: string, entry: QuarkEntry): string {
  const href = pathname === '/' ? '/dav/' : `/dav${pathname}${entry.isDirectory && !pathname.endsWith('/') ? '/' : ''}`
  const resourceType = entry.isDirectory ? '<D:collection/>' : ''
  const contentLength = entry.isDirectory ? '' : `<D:getcontentlength>${String(entry.size)}</D:getcontentlength>`

  return `  <D:response>
    <D:href>${escapeXml(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(entry.name || '/')}</D:displayname>
        <D:resourcetype>${resourceType}</D:resourcetype>
        <D:getcontenttype>${escapeXml(entry.contentType ?? (entry.isDirectory ? 'httpd/unix-directory' : 'application/octet-stream'))}</D:getcontenttype>
        ${contentLength}
        <D:getlastmodified>${escapeXml(toHttpDate(entry.updatedAt))}</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`
}

function joinDavPath(parentPath: string, childName: string): string {
  if (parentPath === '/') {
    return `/${childName}`
  }

  return `${parentPath}/${childName}`
}

function notFoundResponse(message: string): Response {
  return new Response(message, {
    status: 404,
    headers: {
      ...DAV_HEADERS,
      'content-type': 'text/plain; charset=utf-8',
    },
  })
}

function handleQuarkError(error: unknown): Response {
  if (error instanceof QuarkApiError) {
    setDriveConnectionState({
      driveReady: false,
      driveStatus: 'Quark upstream bridge is unavailable.',
      error: error.message,
    })

    const status = error.status >= 400 && error.status < 500 ? 502 : 502
    return new Response(error.message, {
      status,
      headers: {
        ...DAV_HEADERS,
        'content-type': 'text/plain; charset=utf-8',
      },
    })
  }

  if (error instanceof Error && error.message === 'Directories do not have downloadable content.') {
    return new Response(error.message, {
      status: 405,
      headers: {
        ...DAV_HEADERS,
        'content-type': 'text/plain; charset=utf-8',
      },
    })
  }

  setDriveConnectionState({
    driveReady: false,
    driveStatus: 'Quark upstream bridge failed unexpectedly.',
    error: error instanceof Error ? error.message : 'unknown-upstream-error',
  })

  return new Response(error instanceof Error ? error.message : 'Unexpected Quark upstream error.', {
    status: 502,
    headers: {
      ...DAV_HEADERS,
      'content-type': 'text/plain; charset=utf-8',
    },
  })
}

function createRangeHeaders(request: Request): HeadersInit | undefined {
  const range = request.headers.get('range')
  if (!range) {
    return undefined
  }

  return {
    range,
  }
}

function isExpiredDownloadResponse(status: number): boolean {
  return status === 401 || status === 403 || status === 404
}

function parseBasicAuth(
  request: Request,
): { ok: true; username: string; password: string } | { ok: false; message: string } {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Basic ')) {
    return {
      ok: false,
      message: 'Missing WebDAV Basic Auth credentials.',
    }
  }

  const encoded = authorization.slice('Basic '.length).trim()
  let decoded = ''
  try {
    decoded = atob(encoded)
  } catch {
    return {
      ok: false,
      message: 'Malformed WebDAV Basic Auth header.',
    }
  }

  const separatorIndex = decoded.indexOf(':')
  if (separatorIndex < 0) {
    return {
      ok: false,
      message: 'Malformed WebDAV Basic Auth payload.',
    }
  }

  const username = decoded.slice(0, separatorIndex)
  const password = decoded.slice(separatorIndex + 1)

  return { ok: true, username, password }
}

function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false
  }

  let result = 0
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return result === 0
}

function toHttpDate(value?: string): string {
  const date = value ? new Date(value) : new Date(0)
  return Number.isNaN(date.getTime()) ? new Date(0).toUTCString() : date.toUTCString()
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
