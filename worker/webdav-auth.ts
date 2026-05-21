import {
  getPersistedQuarkSessionByAccountKey,
  getWebDavCredentialsByUsername,
  type WebDavCredentials,
} from './session-store'

export const WEBDAV_AUTH_REALM = 'Quark WebDAV'

type BasicAuthResult =
  | { ok: true; username: string; password: string }
  | { ok: false; message: string }

type WebDavAuthSuccess = {
  ok: true
  credentials: WebDavCredentials
}

type WebDavAuthFailure = {
  ok: false
  response: Response
}

export async function authenticateWebDavRequest(request: Request, env: Env): Promise<WebDavAuthSuccess | WebDavAuthFailure> {
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

  const persistedSession = await getPersistedQuarkSessionByAccountKey(credentials.accountKey, env)
  if (!persistedSession?.cookie) {
    return {
      ok: false,
      response: createWebDavAuthChallengeResponse('No bound Quark session is available for this WebDAV account.'),
    }
  }

  return {
    ok: true,
    credentials,
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
