import { constantTimeEquals } from '../auth'
import { jsonError, jsonMessage, jsonOk, readJsonBody } from '../http'
import { QuarkClient } from '../quark/client'
import {
  clearSession,
  ensureWebDavCredentialsForCurrentSession,
  getQrRequest,
  getSessionStatus,
  getSessionCookie,
  getWebDavCredentialsByUsername,
  linkQrRequestToCookieSession,
  listPersistedQuarkSessions,
  mergeUpstreamCookies,
  persistQuarkSessionForCurrentSession,
  rehydrateCurrentSessionFromPersistence,
  restorePersistedSession,
  saveQrRequest,
  saveCookieSession,
  updateQrRequest,
  updateCurrentWebDavCredentials,
} from '../session-store'
import { probeDriveConnection } from '../webdav'

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

type RestoreSessionRequest = {
  accountKey?: string
}

type WebDavLoginRequest = {
  username?: string
  password?: string
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
    const restored = await rehydrateCurrentSessionFromPersistence(origin, env)
    const persistedSessions = restored ? [] : await listPersistedQuarkSessions(env)
    await ensureWebDavCredentialsForCurrentSession(env)
    const sessionStatus = getSessionStatus(origin)
    if (sessionStatus.loggedIn && sessionStatus.accountKey) {
      await probeDriveConnection(sessionStatus.accountKey, env)
    }

    return jsonOk({
      ...getSessionStatus(origin),
      restorableSessions: persistedSessions,
      requiresAccountSelection: !restored && persistedSessions.length > 1,
    })
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

    try {
      saveCookieSession(body.cookie, origin)
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : 'Cookie session could not be bound to an account.', 400)
    }

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

  if (route === '/api/session/login' && request.method === 'POST') {
    const body = await parseWebDavLoginRequest(request)
    if (!body.ok) {
      return body.response
    }

    const credentials = await getWebDavCredentialsByUsername(body.username, env)
    if (!credentials || !constantTimeEquals(body.password, credentials.password)) {
      return jsonError('WebDAV 用户名或密码不正确。', 401)
    }

    const restored = await restorePersistedSession(credentials.accountKey, origin, env)
    if (!restored) {
      return jsonError('该 WebDAV 账户对应的夸克会话不存在或已过期，请重新扫码或重新导入 Cookie。', 401)
    }

    await ensureWebDavCredentialsForCurrentSession(env)
    return jsonMessage(getSessionStatus(origin), 'WebDAV login restored the persisted session.')
  }

  if (route === '/api/session/restore' && request.method === 'POST') {
    let body: RestoreSessionRequest

    try {
      body = await readJsonBody<RestoreSessionRequest>(request)
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : 'Invalid JSON body.', 400)
    }

    const accountKey = body.accountKey?.trim()
    if (!accountKey) {
      return jsonError('Account key is required.', 400)
    }

    const restored = await restorePersistedSession(accountKey, origin, env)
    if (!restored) {
      return jsonError('Requested persisted session was not found.', 404)
    }

    await ensureWebDavCredentialsForCurrentSession(env)
    return jsonMessage(getSessionStatus(origin), 'Persisted session restored.')
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

async function parseWebDavLoginRequest(
  request: Request,
): Promise<
  | { ok: true; username: string; password: string }
  | { ok: false; response: Response }
> {
  let body: WebDavLoginRequest

  try {
    body = await readJsonBody<WebDavLoginRequest>(request)
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
