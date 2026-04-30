import { QuarkAdapter } from './quark/adapter'
import { QuarkApiError, type QuarkEntry } from './quark/types'
import {
  getPersistedQuarkSessionByAccountKey,
  mergeCookieString,
  persistQuarkSessionForAccount,
  setDriveConnectionState,
} from './session-store'
import { authenticateWebDavRequest, createWebDavAuthChallengeResponse } from './webdav-auth'

const DAV_HEADERS = {
  DAV: '1',
  Allow: 'OPTIONS, PROPFIND, GET, HEAD',
  'MS-Author-Via': 'DAV',
  'Cache-Control': 'no-store',
} satisfies HeadersInit

const READ_ONLY_DAV_METHODS = new Set([
  'LOCK',
  'UNLOCK',
  'PROPPATCH',
  'COPY',
  'PATCH',
])

export async function handleWebDavRequest(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url)
    const auth = await authenticateWebDavRequest(request, env)
    if (!auth.ok) {
      return createWebDavAuthChallengeResponse(await auth.response.text(), {
        status: auth.response.status,
        headers: DAV_HEADERS,
      })
    }

    const credentials = auth.credentials

    const persistedSession = await getPersistedQuarkSessionByAccountKey(credentials.accountKey, env)
    if (!persistedSession?.cookie) {
      return createWebDavAuthChallengeResponse('No bound Quark session is available for this WebDAV account.', {
        status: 401,
        headers: DAV_HEADERS,
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
      return handleGet(adapter, url, request, accountCookie, persistedSession.user)
    }

    if (request.method === 'MKCOL') {
      return handleMkcol(adapter, url)
    }

    if (request.method === 'PUT') {
      return handlePut(adapter, url, request)
    }

    if (request.method === 'DELETE') {
      return handleDelete(adapter, url)
    }

    if (request.method === 'MOVE') {
      return handleMove(adapter, request, url)
    }

    if (READ_ONLY_DAV_METHODS.has(request.method)) {
      return new Response(`WebDAV method ${request.method} is disabled because this server is currently read-only.`, {
        status: 405,
        headers: {
          ...DAV_HEADERS,
          'content-type': 'text/plain; charset=utf-8',
        },
      })
    }

    return new Response('WebDAV write operations are not implemented in this MVP.', {
      status: 405,
      headers: {
        ...DAV_HEADERS,
        'content-type': 'text/plain; charset=utf-8',
      },
    })
  } catch (error) {
    if (error instanceof URIError) {
      return new Response('Malformed WebDAV request path.', {
        status: 400,
        headers: {
          ...DAV_HEADERS,
          'content-type': 'text/plain; charset=utf-8',
        },
      })
    }

    throw error
  }
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
  accountCookie: string,
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
      headers: createDownloadHeaders(accountCookie, request),
    })

    if (isExpiredDownloadResponse(upstreamResponse.status)) {
      const refreshed = await adapter.getDownloadUrl(pathname, { forceRefresh: true })
      upstreamResponse = await fetch(refreshed.downloadUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: createDownloadHeaders(accountCookie, request),
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

async function handleMkcol(adapter: QuarkAdapter, url: URL): Promise<Response> {
  const pathname = normalizeDavPath(url.pathname)

  try {
    await adapter.makeCollection(pathname)
    return new Response(null, {
      status: 201,
      headers: DAV_HEADERS,
    })
  } catch (error) {
    return handleWriteError(error)
  }
}

async function handlePut(adapter: QuarkAdapter, url: URL, request: Request): Promise<Response> {
  const pathname = normalizeDavPath(url.pathname)

  try {
    const contentLength = Number(request.headers.get('content-length') ?? '0')
    if (contentLength > 10 * 1024 * 1024) {
      return new Response('Current Worker upload MVP supports files up to 10 MB.', {
        status: 413,
        headers: {
          ...DAV_HEADERS,
          'content-type': 'text/plain; charset=utf-8',
        },
      })
    }

    const bytes = new Uint8Array(await request.arrayBuffer())
    const result = await adapter.putFile(
      pathname,
      bytes,
      request.headers.get('content-type') ?? 'application/octet-stream',
    )
    return new Response(null, {
      status: result.created ? 201 : 204,
      headers: DAV_HEADERS,
    })
  } catch (error) {
    return handleWriteError(error)
  }
}

async function handleDelete(adapter: QuarkAdapter, url: URL): Promise<Response> {
  const pathname = normalizeDavPath(url.pathname)

  try {
    await adapter.deletePath(pathname)
    return new Response(null, {
      status: 204,
      headers: DAV_HEADERS,
    })
  } catch (error) {
    return handleWriteError(error)
  }
}

async function handleMove(adapter: QuarkAdapter, request: Request, url: URL): Promise<Response> {
  const sourcePath = normalizeDavPath(url.pathname)
  const destinationHeader = request.headers.get('destination')
  if (!destinationHeader) {
    return new Response('MOVE request requires a Destination header.', {
      status: 400,
      headers: {
        ...DAV_HEADERS,
        'content-type': 'text/plain; charset=utf-8',
      },
    })
  }

  try {
    const destinationUrl = new URL(destinationHeader, url.origin)
    const destinationPath = normalizeDavPath(destinationUrl.pathname)
    await adapter.movePath(sourcePath, destinationPath)
    return new Response(null, {
      status: 201,
      headers: DAV_HEADERS,
    })
  } catch (error) {
    return handleWriteError(error)
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

function handleWriteError(error: unknown): Response {
  if (error instanceof QuarkApiError) {
    if (error.code === 23008) {
      return new Response(error.message, {
        status: 409,
        headers: {
          ...DAV_HEADERS,
          'content-type': 'text/plain; charset=utf-8',
        },
      })
    }

    const status = error.status === 413 ? 413 : 502
    return new Response(error.message, {
      status,
      headers: {
        ...DAV_HEADERS,
        'content-type': 'text/plain; charset=utf-8',
      },
    })
  }

  if (error instanceof Error) {
    if (error.message === 'Parent directory does not exist.') {
      return new Response(error.message, {
        status: 409,
        headers: {
          ...DAV_HEADERS,
          'content-type': 'text/plain; charset=utf-8',
        },
      })
    }

    if (
      error.message === 'Cannot create the root directory.' ||
      error.message === 'Directory already exists.' ||
      error.message === 'A file already exists at the requested directory path.' ||
      error.message === 'Cannot delete the root path.' ||
      error.message === 'Cannot move the root path.' ||
      error.message === 'Target file name is required.' ||
      error.message === 'Directory name is required.' ||
      error.message === 'File name is required.' ||
      error.message === 'Cannot overwrite a directory with file content.' ||
      error.message === 'Cannot upload to the root path.'
    ) {
      return new Response(error.message, {
        status: 400,
        headers: {
          ...DAV_HEADERS,
          'content-type': 'text/plain; charset=utf-8',
        },
      })
    }
  }

  return new Response(error instanceof Error ? error.message : 'Unexpected WebDAV write error.', {
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

function createDownloadHeaders(cookie: string, request: Request): HeadersInit {
  return {
    cookie,
    referer: 'https://pan.quark.cn/',
    origin: 'https://pan.quark.cn',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.56 Chrome/100.0.4896.160 Electron/18.3.5.12 Safari/537.36',
    ...(createRangeHeaders(request) ?? {}),
  }
}

function isExpiredDownloadResponse(status: number): boolean {
  return status === 401 || status === 403 || status === 404
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
