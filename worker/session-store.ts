export type AccountStatus = 'pending' | 'approved' | 'rejected'

export type AccountRecord = {
  accountKey: string
  identityKey: string
  nickname?: string
  userId?: string
  status: AccountStatus
  registeredAt: string
  updatedAt: string
  lastLoginAt: string
}

export type SessionStatus = {
  loggedIn: boolean
  accountKey?: string
  accountStatus?: AccountStatus | 'unregistered'
  user?: string
  expiresAt?: string
  endpoint: string
  authType?: string
  driveReady: boolean
  driveStatus: string
  error?: string
  webdavCredentials?: WebDavCredentials
}

export type WebDavCredentials = {
  accountKey: string
  username: string
  password: string
  createdAt: string
  updatedAt: string
}

export type PersistedQuarkSession = {
  accountKey: string
  cookie: string
  user?: string
  expiresAt?: string
  updatedAt: string
}

export type DriveConnectionState = {
  driveReady: boolean
  driveStatus: string
  error?: string
}

export type QrRequestRecord = {
  requestId: string
  qrUrl: string
  qrToken: string
  expiresAt: string
  status: 'pending' | 'linked' | 'expired'
  createdAt: string
  serviceTicket?: string
  lastError?: string
  cookieJar: string
}

const COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_QR_REQUESTS = 20
const MERGEABLE_COOKIE_KEYS = new Set([
  '__puus',
  '__pus',
  '__kp',
  '__kps',
  'sid',
  'st',
])

const qrRequests = new Map<string, QrRequestRecord>()
const driveStateByAccount = new Map<string, DriveConnectionState>()

export async function deriveAccountKey(identityKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identityKey))
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return hex.slice(0, 32)
}

export async function createAccount(
  input: { identityKey: string; nickname?: string; userId?: string },
  env?: Env,
): Promise<AccountRecord> {
  const now = new Date().toISOString()
  const accountKey = await deriveAccountKey(input.identityKey)
  const record: AccountRecord = {
    accountKey,
    identityKey: input.identityKey,
    nickname: input.nickname,
    userId: input.userId,
    status: 'pending',
    registeredAt: now,
    updatedAt: now,
    lastLoginAt: now,
  }

  const namespace = env?.DAV_CREDENTIALS
  if (namespace) {
    await namespace.put(getAccountStorageKey(accountKey), JSON.stringify(record))
    await namespace.put(
      getIdentityStorageKey(input.identityKey),
      JSON.stringify({ accountKey, updatedAt: now }),
    )
  }

  return record
}

export async function getAccount(accountKey: string, env?: Env): Promise<AccountRecord | null> {
  const namespace = env?.DAV_CREDENTIALS
  if (!namespace) {
    return null
  }

  const payload = await namespace.get(getAccountStorageKey(accountKey), 'json')
  return normalizeAccountRecord(payload)
}

export async function findAccountByIdentityKey(
  identityKey: string,
  env?: Env,
): Promise<AccountRecord | null> {
  const accountKey = await lookupAccountKeyByIdentityKey(identityKey, env)
  if (!accountKey) {
    return null
  }

  return getAccount(accountKey, env)
}

export async function lookupAccountKeyByIdentityKey(
  identityKey: string,
  env?: Env,
): Promise<string | null> {
  const namespace = env?.DAV_CREDENTIALS
  if (!namespace) {
    return null
  }

  const payload = await namespace.get(getIdentityStorageKey(identityKey), 'json')
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const accountKey = (payload as { accountKey?: unknown }).accountKey
  return typeof accountKey === 'string' && accountKey.length > 0 ? accountKey : null
}

export async function listAccounts(env?: Env): Promise<AccountRecord[]> {
  const namespace = env?.DAV_CREDENTIALS
  if (!namespace) {
    return []
  }

  const records: AccountRecord[] = []
  let cursor: string | undefined
  do {
    const listed = await namespace.list({ prefix: 'davaccount:v1:', cursor })
    for (const key of listed.keys) {
      const record = normalizeAccountRecord(await namespace.get(key.name, 'json'))
      if (record) {
        records.push(record)
      }
    }
    cursor = listed.list_complete ? undefined : listed.cursor
  } while (cursor)

  return records.sort((left, right) => right.registeredAt.localeCompare(left.registeredAt))
}

export async function setAccountStatus(
  accountKey: string,
  status: AccountStatus,
  env?: Env,
): Promise<AccountRecord | null> {
  const account = await getAccount(accountKey, env)
  if (!account) {
    return null
  }

  const next: AccountRecord = {
    ...account,
    status,
    updatedAt: new Date().toISOString(),
  }
  await persistAccount(next, env)
  return next
}

export async function touchAccount(
  accountKey: string,
  patch: { nickname?: string; userId?: string; lastLoginAt?: string },
  env?: Env,
): Promise<AccountRecord | null> {
  const account = await getAccount(accountKey, env)
  if (!account) {
    return null
  }

  const next: AccountRecord = {
    ...account,
    nickname: patch.nickname ?? account.nickname,
    userId: patch.userId ?? account.userId,
    lastLoginAt: patch.lastLoginAt ?? account.lastLoginAt,
    updatedAt: new Date().toISOString(),
  }
  await persistAccount(next, env)
  return next
}

export async function deleteAccountAndData(
  accountKey: string,
  env?: Env,
): Promise<{ session?: PersistedQuarkSession; identityKey?: string }> {
  const account = await getAccount(accountKey, env)
  const session = await getPersistedQuarkSessionByAccountKey(accountKey, env)
  const credentials = await loadPersistedWebDavCredentials(accountKey, env)

  const namespace = env?.DAV_CREDENTIALS
  if (namespace) {
    await namespace.delete(getAccountStorageKey(accountKey))
    await namespace.delete(getQuarkSessionStorageKey(accountKey))
    await namespace.delete(getWebDavCredentialsStorageKey(accountKey))
    if (credentials) {
      await namespace.delete(getWebDavUsernameIndexStorageKey(credentials.username))
    }
    if (account) {
      await namespace.delete(getIdentityStorageKey(account.identityKey))
    }
  }

  driveStateByAccount.delete(accountKey)

  return {
    session: session ?? undefined,
    identityKey: account?.identityKey,
  }
}

export async function saveQuarkSessionForAccount(
  accountKey: string,
  cookie: string,
  metadata?: { user?: string; expiresAt?: string },
  env?: Env,
): Promise<void> {
  const namespace = env?.DAV_CREDENTIALS
  if (!namespace) {
    return
  }

  const record: PersistedQuarkSession = {
    accountKey,
    cookie,
    user: metadata?.user,
    expiresAt: metadata?.expiresAt,
    updatedAt: new Date().toISOString(),
  }

  await namespace.put(getQuarkSessionStorageKey(accountKey), JSON.stringify(record))
}

export async function getPersistedQuarkSessionByAccountKey(
  accountKey: string,
  env?: Env,
): Promise<PersistedQuarkSession | null> {
  const namespace = env?.DAV_CREDENTIALS
  if (!namespace) {
    return null
  }

  const payload = await namespace.get(getQuarkSessionStorageKey(accountKey), 'json')
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as Partial<PersistedQuarkSession>
  if (
    typeof record.accountKey !== 'string' ||
    typeof record.cookie !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    return null
  }

  return {
    accountKey: record.accountKey,
    cookie: record.cookie,
    user: record.user,
    expiresAt: record.expiresAt,
    updatedAt: record.updatedAt,
  }
}

export async function clearQuarkSessionForAccount(accountKey: string, env?: Env): Promise<void> {
  const namespace = env?.DAV_CREDENTIALS
  if (namespace) {
    await namespace.delete(getQuarkSessionStorageKey(accountKey))
  }
  driveStateByAccount.delete(accountKey)
}

export async function ensureCredentialsForAccount(
  accountKey: string,
  env?: Env,
): Promise<WebDavCredentials> {
  const persisted = await loadPersistedWebDavCredentials(accountKey, env)
  if (persisted) {
    return persisted
  }

  const now = new Date().toISOString()
  const nextCredentials: WebDavCredentials = {
    accountKey,
    username: generateDefaultUsername(accountKey),
    password: generateRandomPassword(),
    createdAt: now,
    updatedAt: now,
  }
  await persistWebDavCredentials(nextCredentials, env)
  return nextCredentials
}

export async function loadPersistedWebDavCredentials(
  accountKey: string,
  env?: Env,
): Promise<WebDavCredentials | null> {
  const namespace = env?.DAV_CREDENTIALS
  if (!namespace) {
    return null
  }

  const payload = await namespace.get(getWebDavCredentialsStorageKey(accountKey), 'json')
  return normalizeCredentialsRecord(payload)
}

export async function getWebDavCredentialsByUsername(
  username: string,
  env?: Env,
): Promise<WebDavCredentials | null> {
  const namespace = env?.DAV_CREDENTIALS
  if (!namespace) {
    return null
  }

  const payload = await namespace.get(getWebDavUsernameIndexStorageKey(username), 'json')
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as Partial<WebDavUsernameIndex>
  if (typeof record.accountKey !== 'string' || typeof record.username !== 'string') {
    return null
  }

  const credentials = await loadPersistedWebDavCredentials(record.accountKey, env)
  if (!credentials || credentials.username !== username) {
    return null
  }

  return credentials
}

export async function updateWebDavCredentialsForAccount(
  accountKey: string,
  username: string,
  password: string,
  env?: Env,
): Promise<{ ok: true; credentials: WebDavCredentials } | { ok: false; error: string }> {
  const current = await loadPersistedWebDavCredentials(accountKey, env)
  if (!current) {
    return { ok: false, error: 'Account has no WebDAV credentials yet. Log in first.' }
  }

  const nextUsername = username.trim()
  const nextPassword = password.trim()
  if (nextUsername !== current.username) {
    const existing = await getWebDavCredentialsByUsername(nextUsername, env)
    if (existing && existing.accountKey !== accountKey) {
      return { ok: false, error: '该 WebDAV 用户名已被其他账户使用，请换一个。' }
    }
  }

  const nextCredentials: WebDavCredentials = {
    ...current,
    username: nextUsername,
    password: nextPassword,
    updatedAt: new Date().toISOString(),
  }
  await persistWebDavCredentials(nextCredentials, env, current.username)
  return { ok: true, credentials: nextCredentials }
}

export function getQrRequest(requestId: string): QrRequestRecord | null {
  cleanupExpiredQrRequests()
  return qrRequests.get(requestId) ?? null
}

export function saveQrRequest(record: {
  requestId?: string
  qrUrl: string
  qrToken: string
  expiresAt: string
  status?: QrRequestRecord['status']
  cookieJar?: string
}): QrRequestRecord {
  cleanupExpiredQrRequests()

  const nextRecord: QrRequestRecord = {
    requestId: record.requestId ?? crypto.randomUUID(),
    qrUrl: record.qrUrl,
    qrToken: record.qrToken,
    expiresAt: record.expiresAt,
    status: record.status ?? 'pending',
    createdAt: new Date().toISOString(),
    cookieJar: record.cookieJar ?? '',
  }

  qrRequests.set(nextRecord.requestId, nextRecord)
  trimQrRequests()
  return nextRecord
}

export function updateQrRequest(
  requestId: string,
  patch: Partial<
    Pick<
      QrRequestRecord,
      'status' | 'serviceTicket' | 'lastError' | 'expiresAt' | 'qrUrl' | 'qrToken' | 'cookieJar'
    >
  >,
): QrRequestRecord | null {
  const record = qrRequests.get(requestId)
  if (!record) {
    return null
  }

  const nextRecord: QrRequestRecord = {
    ...record,
    ...patch,
  }

  qrRequests.set(requestId, nextRecord)
  return nextRecord
}

export function setDriveConnectionState(accountKey: string, update: DriveConnectionState): void {
  driveStateByAccount.set(accountKey, update)
}

export function getDriveConnectionState(accountKey: string): DriveConnectionState | undefined {
  return driveStateByAccount.get(accountKey)
}

export async function getSessionStatus(
  origin: string,
  accountKey: string,
  env?: Env,
): Promise<SessionStatus> {
  const account = await getAccount(accountKey, env)
  const session = await getPersistedQuarkSessionByAccountKey(accountKey, env)
  const credentials = await loadPersistedWebDavCredentials(accountKey, env)
  const drive = getDriveConnectionState(accountKey)

  return {
    loggedIn: Boolean(session?.cookie),
    accountKey,
    accountStatus: account?.status ?? 'unregistered',
    user: account?.nickname ?? session?.user,
    expiresAt: session?.expiresAt,
    endpoint: createDavEndpoint(origin),
    authType: session ? 'cookie' : undefined,
    driveReady: drive?.driveReady ?? false,
    driveStatus:
      drive?.driveStatus ??
      (session
        ? 'Restored persisted Quark session. Upstream bridge will be validated on next access.'
        : 'Waiting for Quark session.'),
    error: drive?.error,
    webdavCredentials: credentials ?? undefined,
  }
}

export function createAnonymousSessionStatus(origin: string): SessionStatus {
  return {
    loggedIn: false,
    accountStatus: 'unregistered',
    endpoint: createDavEndpoint(origin),
    driveReady: false,
    driveStatus: 'Waiting for Quark session.',
    error: undefined,
    webdavCredentials: undefined,
  }
}

export function computeSessionExpiry(): string {
  return new Date(Date.now() + COOKIE_TTL_MS).toISOString()
}

export function mergeCookieString(
  currentCookie: string | null | undefined,
  cookieUpdates: string[],
): string | null {
  if (cookieUpdates.length === 0) {
    return currentCookie ?? null
  }

  const cookieMap = currentCookie ? parseCookieString(currentCookie) : new Map<string, string>()
  let changed = false

  for (const headerValue of cookieUpdates) {
    const parsed = parseSetCookieHeader(headerValue)
    if (!parsed || !MERGEABLE_COOKIE_KEYS.has(parsed.name)) {
      continue
    }

    if (parsed.deleteCookie) {
      changed = cookieMap.delete(parsed.name) || changed
      continue
    }

    const previous = cookieMap.get(parsed.name)
    if (previous !== parsed.value) {
      cookieMap.set(parsed.name, parsed.value)
      changed = true
    }
  }

  if (!changed) {
    return currentCookie ?? null
  }

  const nextCookie = serializeCookieMap(cookieMap)
  return nextCookie || null
}

type WebDavUsernameIndex = {
  accountKey: string
  username: string
  updatedAt: string
}

async function persistAccount(record: AccountRecord, env?: Env): Promise<void> {
  const namespace = env?.DAV_CREDENTIALS
  if (!namespace) {
    return
  }

  await namespace.put(getAccountStorageKey(record.accountKey), JSON.stringify(record))
}

async function persistWebDavCredentials(
  credentials: WebDavCredentials,
  env?: Env,
  previousUsername?: string,
): Promise<void> {
  const namespace = env?.DAV_CREDENTIALS
  if (!namespace) {
    return
  }

  if (previousUsername && previousUsername !== credentials.username) {
    await namespace.delete(getWebDavUsernameIndexStorageKey(previousUsername))
  }

  await namespace.put(
    getWebDavCredentialsStorageKey(credentials.accountKey),
    JSON.stringify(credentials),
  )
  await namespace.put(
    getWebDavUsernameIndexStorageKey(credentials.username),
    JSON.stringify({
      accountKey: credentials.accountKey,
      username: credentials.username,
      updatedAt: credentials.updatedAt,
    } satisfies WebDavUsernameIndex),
  )
}

function normalizeAccountRecord(payload: unknown): AccountRecord | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as Partial<AccountRecord>
  if (
    typeof record.accountKey !== 'string' ||
    typeof record.identityKey !== 'string' ||
    typeof record.status !== 'string' ||
    typeof record.registeredAt !== 'string' ||
    typeof record.updatedAt !== 'string' ||
    typeof record.lastLoginAt !== 'string'
  ) {
    return null
  }

  return {
    accountKey: record.accountKey,
    identityKey: record.identityKey,
    nickname: record.nickname,
    userId: record.userId,
    status: record.status as AccountStatus,
    registeredAt: record.registeredAt,
    updatedAt: record.updatedAt,
    lastLoginAt: record.lastLoginAt,
  }
}

function normalizeCredentialsRecord(payload: unknown): WebDavCredentials | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as Partial<WebDavCredentials>
  if (
    typeof record.accountKey !== 'string' ||
    typeof record.username !== 'string' ||
    typeof record.password !== 'string' ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    return null
  }

  return {
    accountKey: record.accountKey,
    username: record.username,
    password: record.password,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function getAccountStorageKey(accountKey: string): string {
  return `davaccount:v1:${accountKey}`
}

function getIdentityStorageKey(identityKey: string): string {
  return `identity:v1:${identityKey}`
}

function getWebDavCredentialsStorageKey(accountKey: string): string {
  return `davcred:v1:${accountKey}`
}

function getWebDavUsernameIndexStorageKey(username: string): string {
  return `davuser:v1:${username}`
}

function getQuarkSessionStorageKey(accountKey: string): string {
  return `quarksession:v1:${accountKey}`
}

function createDavEndpoint(origin: string): string {
  return `${origin}/dav`
}

function cleanupExpiredQrRequests(): void {
  const now = Date.now()

  for (const [requestId, record] of qrRequests.entries()) {
    if (new Date(record.expiresAt).getTime() <= now) {
      qrRequests.delete(requestId)
    }
  }
}

function trimQrRequests(): void {
  if (qrRequests.size <= MAX_QR_REQUESTS) {
    return
  }

  const records = [...qrRequests.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )

  for (const record of records.slice(0, qrRequests.size - MAX_QR_REQUESTS)) {
    qrRequests.delete(record.requestId)
  }
}

function generateDefaultUsername(accountKey: string): string {
  const normalized = accountKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 18)

  return normalized ? `quark-${normalized}` : `quark-${crypto.randomUUID().slice(0, 8)}`
}

function generateRandomPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#$^&*._-'
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join('')
}

function parseCookieString(cookie: string): Map<string, string> {
  const cookieMap = new Map<string, string>()
  for (const segment of cookie.split(';')) {
    const trimmed = segment.trim()
    if (!trimmed) {
      continue
    }

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const name = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim()
    if (!name) {
      continue
    }

    cookieMap.set(name, value)
  }

  return cookieMap
}

function serializeCookieMap(cookieMap: Map<string, string>): string {
  return [...cookieMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

function parseSetCookieHeader(
  headerValue: string,
): { name: string; value: string; deleteCookie: boolean } | null {
  const segments = headerValue
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)

  const firstSegment = segments[0]
  if (!firstSegment) {
    return null
  }

  const separatorIndex = firstSegment.indexOf('=')
  if (separatorIndex <= 0) {
    return null
  }

  const name = firstSegment.slice(0, separatorIndex).trim()
  const value = firstSegment.slice(separatorIndex + 1).trim()
  if (!name) {
    return null
  }

  const deleteCookie = segments.some((segment) => {
    const lower = segment.toLowerCase()
    if (lower === 'max-age=0') {
      return true
    }

    if (!lower.startsWith('expires=')) {
      return false
    }

    const expiresValue = segment.slice('expires='.length).trim()
    const expiresAt = new Date(expiresValue)
    return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()
  })

  return {
    name,
    value,
    deleteCookie,
  }
}
