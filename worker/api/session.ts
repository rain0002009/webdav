import { jsonError, jsonMessage, jsonOk, readJsonBody } from '../http'
import { QuarkClient } from '../quark/client'
import {
  clearSession,
  ensureWebDavCredentialsForCurrentSession,
  getQrRequest,
  getSessionStatus,
  getSessionCookie,
  linkQrRequestToCookieSession,
  mergeUpstreamCookies,
  persistQuarkSessionForCurrentSession,
  rehydrateCurrentSessionFromPersistence,
  saveQrRequest,
  saveCookieSession,
  updateQrRequest,
  updateCurrentWebDavCredentials,
} from '../session-store'
import { authenticateWebDavRequest } from '../webdav-auth'

type CookieUpdateRequest = {
  cookie?: string
}

type CookieUpdateResponse = {
  updated: boolean
  message?: string
}

type WebDavCredentialsUpdateRequest = {
  username?: string
  password?: string
}

type LogoutResponse = {
  cleared: boolean
  message: string
}

type QrStartResponse = {
  requestId: string
  qrUrl: string
  qrToken: string
  expiresAt: string
  message: string
}

type QrStatusResponse = {
  requestId: string
  status: string
  qrUrl: string
  qrToken: string
  expiresAt: string
  loggedIn: boolean
  message: string
  error?: string
}

export async function handleSessionApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const route = url.pathname
  const origin = url.origin

  if (route === '/api/session/status' && request.method === 'GET') {
    const auth = await authenticateWebDavRequest(request, env)
    if (!auth.ok) {
      return jsonError(await auth.response.text(), auth.response.status, {
        headers: Object.fromEntries(auth.response.headers.entries()),
      })
    }

    await rehydrateCurrentSessionFromPersistence(origin, env)
    await ensureWebDavCredentialsForCurrentSession(env)
    return jsonOk(getSessionStatus(origin))
  }

  if (route === '/api/session/qr/start' && request.method === 'POST') {
    const client = new QuarkClient(getSessionCookie() ?? '', (cookieUpdates) => {
      mergeUpstreamCookies(cookieUpdates)
    })
    const qrLogin = await client.getTokenForQrcodeLogin()
    const record = saveQrRequest({
      qrUrl: qrLogin.qrUrl,
      qrToken: qrLogin.qrToken,
      expiresAt: qrLogin.expiresAt,
    })

    return jsonMessage<QrStartResponse>(
      {
        requestId: record.requestId,
        qrUrl: record.qrUrl,
        qrToken: record.qrToken,
        expiresAt: record.expiresAt,
        message: '二维码登录已启动，请使用夸克扫描二维码并返回此页面查询状态。',
      },
      'QR login session created.',
    )
  }

  if (route === '/api/session/qr/status' && request.method === 'GET') {
    const requestId = url.searchParams.get('requestId')?.trim()
    if (!requestId) {
      return jsonError('Query parameter requestId is required.', 400)
    }

    const record = getQrRequest(requestId)
    if (!record) {
      return jsonError('QR request not found.', 404)
    }

    if (record.status === 'pending') {
      const client = new QuarkClient(getSessionCookie() ?? '', (cookieUpdates) => {
        mergeUpstreamCookies(cookieUpdates)
      })
      const qrStatus = await client.getServiceTicketByQrcodeToken(record.qrToken)

      if (qrStatus.status === 'confirmed' && qrStatus.serviceTicket) {
        await client.getAccountInfoByServiceTicket(qrStatus.serviceTicket)
        const currentCookie = getSessionCookie()
        if (!currentCookie) {
          return jsonError('QR login completed but no usable Quark cookie was captured.', 502)
        }

        const linkedRecord = linkQrRequestToCookieSession(requestId, currentCookie, origin)
        if (!linkedRecord) {
          return jsonError('QR request not found.', 404)
        }

        await persistQuarkSessionForCurrentSession(env)
        await ensureWebDavCredentialsForCurrentSession(env)

        return jsonOk<QrStatusResponse>({
          requestId: linkedRecord.requestId,
          status: linkedRecord.status,
          qrUrl: linkedRecord.qrUrl,
          qrToken: linkedRecord.qrToken,
          expiresAt: linkedRecord.expiresAt,
          loggedIn: true,
          message: '二维码登录成功，当前 Worker 会话已解锁。',
        })
      }

      if (qrStatus.status === 'expired') {
        const expiredRecord = updateQrRequest(requestId, {
          status: 'expired',
          lastError: qrStatus.error,
        })
        if (!expiredRecord) {
          return jsonError('QR request not found.', 404)
        }

        return jsonOk<QrStatusResponse>({
          requestId: expiredRecord.requestId,
          status: expiredRecord.status,
          qrUrl: expiredRecord.qrUrl,
          qrToken: expiredRecord.qrToken,
          expiresAt: expiredRecord.expiresAt,
          loggedIn: false,
          message: '二维码已失效，请重新开始扫码登录。',
          error: 'qr-expired',
        })
      }

      const pendingRecord = updateQrRequest(requestId, {
        lastError: qrStatus.error,
      })
      if (!pendingRecord) {
        return jsonError('QR request not found.', 404)
      }

      return jsonOk<QrStatusResponse>({
        requestId: pendingRecord.requestId,
        status: pendingRecord.status,
        qrUrl: pendingRecord.qrUrl,
        qrToken: pendingRecord.qrToken,
        expiresAt: pendingRecord.expiresAt,
        loggedIn: false,
        message: qrStatus.error ?? '等待夸克扫码确认。',
      })
    }

    const loggedIn = record.status === 'linked'
    const statusMessage =
      record.status === 'linked'
        ? '二维码登录已完成，当前 Worker 会话已认证。'
        : record.status === 'expired'
          ? '二维码已失效，请重新开始扫码登录。'
          : '等待夸克扫码确认。'

    return jsonOk<QrStatusResponse>({
      requestId: record.requestId,
      status: record.status,
      qrUrl: record.qrUrl,
      qrToken: record.qrToken,
      expiresAt: record.expiresAt,
      loggedIn,
      message: statusMessage,
      error: record.status === 'expired' ? 'qr-expired' : record.lastError,
    })
  }

  if (route === '/api/session/cookie' && request.method === 'POST') {
    const body = await parseCookieRequest(request)
    if (!body.ok) {
      return body.response
    }

    saveCookieSession(body.cookie, origin)
    await persistQuarkSessionForCurrentSession(env)
    await ensureWebDavCredentialsForCurrentSession(env)

    return jsonMessage<CookieUpdateResponse>(
      {
        updated: true,
        message: 'Cookie session saved. WebDAV route is now unlocked for this worker isolate.',
      },
      'Cookie session saved.',
    )
  }

  if (route === '/api/session/webdav-credentials' && request.method === 'POST') {
    await rehydrateCurrentSessionFromPersistence(origin, env)
    const body = await parseWebDavCredentialsRequest(request)
    if (!body.ok) {
      return body.response
    }

    const credentials = await updateCurrentWebDavCredentials(body.username, body.password, env)
    if (!credentials) {
      return jsonError('Current Quark session is not logged in.', 401)
    }

    return jsonMessage(
      {
        credentials,
      },
      'WebDAV credentials updated.',
    )
  }

  if (route === '/api/session/logout' && request.method === 'POST') {
    clearSession()

    return jsonOk<LogoutResponse>({
      cleared: true,
      message: 'Worker session cleared.',
    })
  }

  return jsonError('Unsupported session route or method.', 405, {
    headers: {
      allow: 'GET, POST',
    },
  })
}

async function parseCookieRequest(
  request: Request,
): Promise<{ ok: true; cookie: string } | { ok: false; response: Response }> {
  let body: CookieUpdateRequest

  try {
    body = await readJsonBody<CookieUpdateRequest>(request)
  } catch (error) {
    return {
      ok: false,
      response: jsonError(error instanceof Error ? error.message : 'Invalid JSON body.', 400),
    }
  }

  const cookie = body.cookie?.trim()
  if (!cookie) {
    return {
      ok: false,
      response: jsonError('Cookie input cannot be empty.', 400),
    }
  }

  return {
    ok: true,
    cookie,
  }
}

async function parseWebDavCredentialsRequest(
  request: Request,
): Promise<
  | { ok: true; username: string; password: string }
  | { ok: false; response: Response }
> {
  let body: WebDavCredentialsUpdateRequest

  try {
    body = await readJsonBody<WebDavCredentialsUpdateRequest>(request)
  } catch (error) {
    return {
      ok: false,
      response: jsonError(error instanceof Error ? error.message : 'Invalid JSON body.', 400),
    }
  }

  const username = body.username?.trim()
  const password = body.password?.trim()
  if (!username) {
    return {
      ok: false,
      response: jsonError('WebDAV username cannot be empty.', 400),
    }
  }

  if (!password) {
    return {
      ok: false,
      response: jsonError('WebDAV password cannot be empty.', 400),
    }
  }

  return {
    ok: true,
    username,
    password,
  }
}
