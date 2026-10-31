import { tryDeleteIdentityFile } from '../account'
import { jsonError, jsonOk, readJsonBody } from '../http'
import {
  deleteAccountAndData,
  listAccounts,
  loadPersistedWebDavCredentials,
  setAccountStatus,
  type AccountRecord,
  type AccountStatus,
} from '../session-store'
import { constantTimeEquals } from '../webdav-auth'

type AdminEnv = Env & { TOKEN?: string }

type AdminAccountView = {
  accountKey: string
  nickname?: string
  userId?: string
  status: AccountStatus
  registeredAt: string
  lastLoginAt: string
  username?: string
}

type AccountStatusUpdateRequest = {
  status?: string
}

const ACCOUNT_STATUSES = new Set<AccountStatus>(['pending', 'approved', 'rejected'])

export async function handleAdminApiRequest(request: Request, env: Env): Promise<Response> {
  const token = (env as AdminEnv).TOKEN
  if (!token) {
    return jsonError('Admin token is not configured. Set the TOKEN secret first.', 503)
  }

  const provided = extractAdminToken(request)
  if (!provided || !constantTimeEquals(provided, token)) {
    return jsonError('Invalid admin token.', 401)
  }

  const url = new URL(request.url)
  const segments = url.pathname.split('/').filter(Boolean)

  if (segments[2] === 'accounts' && segments.length === 3 && request.method === 'GET') {
    const accounts = await listAccounts(env)
    const views: AdminAccountView[] = []
    for (const account of accounts) {
      views.push(await toAdminView(account, env))
    }
    return jsonOk({ accounts: views })
  }

  if (segments[2] === 'accounts' && segments.length >= 4) {
    const accountKey = segments[3]

    if (segments[4] === 'status' && request.method === 'POST') {
      return handleStatusUpdate(request, accountKey, env)
    }

    if (segments.length === 4 && request.method === 'DELETE') {
      return handleDelete(accountKey, env)
    }
  }

  return jsonError('Unsupported admin route or method.', 405, {
    headers: {
      allow: 'GET, POST, DELETE',
    },
  })
}

async function handleStatusUpdate(
  request: Request,
  accountKey: string,
  env: Env,
): Promise<Response> {
  let body: AccountStatusUpdateRequest
  try {
    body = await readJsonBody<AccountStatusUpdateRequest>(request)
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Invalid JSON body.', 400)
  }

  const status = body.status?.trim()
  if (!status || !ACCOUNT_STATUSES.has(status as AccountStatus)) {
    return jsonError('Field "status" must be one of: pending, approved, rejected.', 400)
  }

  const updated = await setAccountStatus(accountKey, status as AccountStatus, env)
  if (!updated) {
    return jsonError('Account not found.', 404)
  }

  return jsonOk({
    account: await toAdminView(updated, env),
  })
}

async function handleDelete(accountKey: string, env: Env): Promise<Response> {
  const { session, identityKey } = await deleteAccountAndData(accountKey, env)

  let identityFileRemoved = false
  if (session?.cookie && identityKey) {
    identityFileRemoved = await tryDeleteIdentityFile(session.cookie, identityKey)
  }

  return jsonOk({
    deleted: true,
    identityFileRemoved,
  })
}

async function toAdminView(account: AccountRecord, env: Env): Promise<AdminAccountView> {
  const credentials = await loadPersistedWebDavCredentials(account.accountKey, env)
  return {
    accountKey: account.accountKey,
    nickname: account.nickname,
    userId: account.userId,
    status: account.status,
    registeredAt: account.registeredAt,
    lastLoginAt: account.lastLoginAt,
    username: credentials?.username,
  }
}

function extractAdminToken(request: Request): string | null {
  const header = request.headers.get('x-admin-token')?.trim()
  if (header) {
    return header
  }

  const url = new URL(request.url)
  return url.searchParams.get('token')?.trim() ?? null
}
