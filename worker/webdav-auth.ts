import {
  getAccount,
  getWebDavCredentialsByUsername,
  type AccountRecord,
  type WebDavCredentials,
} from './session-store'

export const WEBDAV_AUTH_REALM = 'Quark WebDAV'

type BasicAuthResult =
  | { ok: true; username: string; password: string }
  | { ok: false; message: string }

type WebDavAuthSuccess = {
  ok: true
  credentials: WebDavCredentials
  account: AccountRecord
}

type WebDavAuthFailure = {
  ok: false
  response: Response
}

export async function authenticateWebDavRequest(
  request: Request,
  env: Env,
  options?: { requireApproved?: boolean },
): Promise<WebDavAuthSuccess | WebDavAuthFailure> {
  const auth = parseBasicAuth(request)
  if (!auth.ok) {
    return {
      ok: false,
      response: createWebDavAuthChallengeResponse(auth.message),
    }
  }

  const credentials = await getWebDavCredentialsByUsername(auth.username, env)
  if (!credentials || !constantTimeEquals(auth.password, credentials.password)) {
    return {
      ok: false,
      response: createWebDavAuthChallengeResponse('Invalid WebDAV username or password.'),
    }
  }

  const account = await getAccount(credentials.accountKey, env)
  if (!account) {
    return {
      ok: false,
      response: createWebDavAuthChallengeResponse('Account no longer exists.'),
    }
  }

  if (options?.requireApproved && account.status !== 'approved') {
    const message =
      account.status === 'pending'
        ? '账户待审核：WebDAV 访问尚未激活，请等待管理员审核通过后重试。'
        : '账户已被拒绝：WebDAV 访问已停用，如有疑问请联系管理员。'

    return {
      ok: false,
      response: new Response(message, {
        status: 403,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
      }),
    }
  }

  return {
    ok: true,
    credentials,
    account,
  }
}

export function createWebDavAuthChallengeResponse(message: string, init?: ResponseInit): Response {
  return new Response(message, {
    status: init?.status ?? 401,
    ...init,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'www-authenticate': `Basic realm="${WEBDAV_AUTH_REALM}"`,
      ...(init?.headers ?? {}),
    },
  })
}

export function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false
  }

  let result = 0
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return result === 0
}

function parseBasicAuth(request: Request): BasicAuthResult {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Basic ')) {
    return {
      ok: false,
      message: 'Missing WebDAV Basic Auth credentials.',
    }
  }

  const encoded = authorization.slice('Basic '.length).trim()
  let decoded: string
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
