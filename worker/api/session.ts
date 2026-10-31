import { LoginError, finalizeLogin, type LoginOutcome } from '../account'
import { jsonError, jsonMessage, jsonOk, readJsonBody } from '../http'
import { QuarkClient } from '../quark/client'
import {
  clearQuarkSessionForAccount,
  createAnonymousSessionStatus,
  getQrRequest,
  getSessionStatus,
  mergeCookieString,
  saveQrRequest,
  updateQrRequest,
  updateWebDavCredentialsForAccount,
  type WebDavCredentials,
} from '../session-store'
import { authenticateWebDavRequest } from '../webdav-auth'

type CookieUpdateRequest = {
  cookie?: string
}

type CookieUpdateResponse = {
  updated: boolean
  message?: string
  accountStatus?: string
  webdavCredentials?: WebDavCredentials
}

type WebDavCredentialsUpdateRequest = {
  username?: string
  password?: string
}

const UNSAFE_WEBDAV_PASSWORD_CHARS = /[%@:/]/

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
  accountStatus?: string
  webdavCredentials?: WebDavCredentials
}

export async function handleSessionApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const route = url.pathname
  const origin = url.origin

  if (route === '/api/session/status' && request.method === 'GET') {
    const authHeader = request.headers.get('authorization')
    if (!authHeader) {
      return jsonOk(createAnonymousSessionStatus(origin))
    }

    const auth = await authenticateWebDavRequest(request, env)
    if (!auth.ok) {
      return jsonError(await auth.response.text(), auth.response.status)
    }

    return jsonOk(await getSessionStatus(origin, auth.credentials.accountKey, env))
  }

  if (route === '/api/session/qr/start' && request.method === 'POST') {
    let cookieJar = ''
    const client = new QuarkClient('', (cookieUpdates) => {
      cookieJar = mergeCookieString(cookieJar, cookieUpdates) ?? cookieJar
    })

    try {
      const qrLogin = await client.getTokenForQrcodeLogin()
      const record = saveQrRequest({
        qrUrl: qrLogin.qrUrl,
        qrToken: qrLogin.qrToken,
        expiresAt: qrLogin.expiresAt,
        cookieJar,
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
    } catch (error) {
      return upstreamError(error, 'Failed to start QR login.')
    }
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
      const client = new QuarkClient(record.cookieJar, (cookieUpdates) => {
        record.cookieJar = mergeCookieString(record.cookieJar, cookieUpdates) ?? record.cookieJar
      })

      let qrStatus
      try {
        qrStatus = await client.getServiceTicketByQrcodeToken(record.qrToken)
      } catch (error) {
        return upstreamError(error, 'Failed to query QR login status.')
      }

      if (qrStatus.status === 'confirmed' && qrStatus.serviceTicket) {
        try {
          await client.getAccountInfoByServiceTicket(qrStatus.serviceTicket)
        } catch (error) {
          return upstreamError(error, 'QR login completed but the Quark session exchange failed.')
        }

        const capturedCookie = record.cookieJar
        if (!capturedCookie) {
          return jsonError('QR login completed but no usable Quark cookie was captured.', 502)
        }

        const outcome = await runLogin(capturedCookie, env)
        if ('response' in outcome) {
          return outcome.response
        }

        updateQrRequest(requestId, { status: 'linked', cookieJar: capturedCookie })

        return jsonOk<QrStatusResponse>({
          requestId,
          status: 'linked',
          qrUrl: record.qrUrl,
          qrToken: record.qrToken,
          expiresAt: record.expiresAt,
          loggedIn: true,
          message: describeLoginOutcome(outcome),
          accountStatus: outcome.account.status,
          webdavCredentials: outcome.credentials,
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
        ? '二维码登录已完成，当前账户已认证。'
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

    const outcome = await runLogin(body.cookie, env)
    if ('response' in outcome) {
      return outcome.response
    }

    return jsonMessage<CookieUpdateResponse>(
      {
        updated: true,
        message: describeLoginOutcome(outcome),
        accountStatus: outcome.account.status,
        webdavCredentials: outcome.credentials,
      },
      'Cookie session saved.',
    )
  }

  if (route === '/api/session/webdav-credentials' && request.method === 'POST') {
    const auth = await authenticateWebDavRequest(request, env)
    if (!auth.ok) {
      return jsonError(await auth.response.text(), auth.response.status)
    }

    const body = await parseWebDavCredentialsRequest(request)
    if (!body.ok) {
      return body.response
    }

    const result = await updateWebDavCredentialsForAccount(
      auth.credentials.accountKey,
      body.username,
      body.password,
      env,
    )
    if (!result.ok) {
      return jsonError(result.error, 409)
    }

    return jsonMessage(
      {
        credentials: result.credentials,
      },
      'WebDAV credentials updated.',
    )
  }

  if (route === '/api/session/logout' && request.method === 'POST') {
    const auth = await authenticateWebDavRequest(request, env)
    if (!auth.ok) {
      return jsonError(await auth.response.text(), auth.response.status)
    }

    await clearQuarkSessionForAccount(auth.credentials.accountKey, env)

    return jsonOk<LogoutResponse>({
      cleared: true,
      message: 'Quark session cleared for this account.',
    })
  }

  return jsonError('Unsupported session route or method.', 405, {
    headers: {
      allow: 'GET, POST',
    },
  })
}

async function runLogin(
  cookie: string,
  env: Env,
): Promise<LoginOutcome | { response: Response }> {
  try {
    return await finalizeLogin(cookie, env)
  } catch (error) {
    if (error instanceof LoginError) {
      return { response: jsonError(error.message, error.status) }
    }
    return { response: upstreamError(error, 'Login failed.') }
  }
}

function describeLoginOutcome(outcome: LoginOutcome): string {
  if (outcome.created) {
    return outcome.account.status === 'pending'
      ? '注册申请已提交，WebDAV 凭据已生成但需等待管理员审核通过后才可使用。'
      : '注册完成，WebDAV 凭据已生成。'
  }

  return '登录成功，已合并回原有账户，沿用此前的 WebDAV 用户名和密码。'
}

function upstreamError(error: unknown, fallback: string): Response {
  const message = error instanceof Error && error.message ? error.message : fallback
  return jsonError(message, 502)
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
  { ok: true; username: string; password: string } | { ok: false; response: Response }
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

  if (UNSAFE_WEBDAV_PASSWORD_CHARS.test(password)) {
    return {
      ok: false,
      response: jsonError(
        'WebDAV password cannot contain %, @, :, or / because some clients cannot parse those characters safely.',
        400,
      ),
    }
  }

  return {
    ok: true,
    username,
    password,
  }
}
