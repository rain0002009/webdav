export type SessionStatus = {
  loggedIn: boolean
  user?: string
  expiresAt?: string
  endpoint?: string
  authType?: string
  driveReady?: boolean
  driveStatus?: string
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

type PersistedQuarkSession = {
  accountKey: string
  cookie: string
  user?: string
  expiresAt?: string
  updatedAt: string
}

type WebDavUsernameIndex = {
  accountKey: string
  username: string
  updatedAt: string
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
}

export type SessionSnapshot = {
  cookie?: string
  session: SessionStatus
  activeQrRequest?: QrRequestRecord
}

const QR_TTL_MS = 10 * 60 * 1000
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

const state: {
  cookie?: string
  session: SessionStatus
  qrRequests: Map<string, QrRequestRecord>
  webdavCredentials?: WebDavCredentials
} = {
  session: createLoggedOutSession(),
  qrRequests: new Map<string, QrRequestRecord>(),
}

export function getSessionStatus(origin: string): SessionStatus {
  cleanupExpiredQrRequests()

  return {
    ...state.session,
    endpoint: createDavEndpoint(origin),
    webdavCredentials: state.session.loggedIn ? state.webdavCredentials : undefined,
  }
}

export function startQrRequest(origin: string): QrRequestRecord {
  cleanupExpiredQrRequests()

  const requestId = crypto.randomUUID()
  const qrToken = crypto.randomUUID().replaceAll('-', '')
  const expiresAt = new Date(Date.now() + QR_TTL_MS).toISOString()
  const qrUrl = `${origin}/qr/${qrToken}`
  const record: QrRequestRecord = {
    requestId,
    qrUrl,
    qrToken,
    expiresAt,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }

  state.qrRequests.set(requestId, record)
  trimQrRequests()

  return record
}

export function saveQrRequest(record: {
  requestId?: string
  qrUrl: string
  qrToken: string
  expiresAt: string
  status?: QrRequestRecord['status']
}): QrRequestRecord {
  cleanupExpiredQrRequests()

  const nextRecord: QrRequestRecord = {
    requestId: record.requestId ?? crypto.randomUUID(),
    qrUrl: record.qrUrl,
    qrToken: record.qrToken,
    expiresAt: record.expiresAt,
    status: record.status ?? 'pending',
    createdAt: new Date().toISOString(),
  }

  state.qrRequests.clear()
  state.qrRequests.set(nextRecord.requestId, nextRecord)
  trimQrRequests()
  return nextRecord
}

export function getQrRequest(requestId: string): QrRequestRecord | null {
  cleanupExpiredQrRequests()

  const record = state.qrRequests.get(requestId)
  return record ?? null
}

export function updateQrRequest(
  requestId: string,
  patch: Partial<Pick<QrRequestRecord, 'status' | 'serviceTicket' | 'lastError' | 'expiresAt' | 'qrUrl' | 'qrToken'>>,
): QrRequestRecord | null {
  const record = state.qrRequests.get(requestId)
  if (!record) {
    return null
  }

  const nextRecord: QrRequestRecord = {
    ...record,
    ...patch,
  }

  state.qrRequests.set(requestId, nextRecord)
  return nextRecord
}

export function saveCookieSession(cookie: string, origin: string): SessionStatus {
  const sanitizedCookie = cookie.trim()
  const accountKey = extractCookieAccountKey(sanitizedCookie)
  state.cookie = sanitizedCookie
  const existingCredentials = state.webdavCredentials?.accountKey === accountKey ? state.webdavCredentials : undefined
  state.session = {
    loggedIn: true,
    user: extractCookieUserHint(sanitizedCookie),
    expiresAt: new Date(Date.now() + COOKIE_TTL_MS).toISOString(),
    endpoint: createDavEndpoint(origin),
    authType: 'cookie',
    driveReady: false,
    driveStatus: 'Cookie session stored. Quark upstream bridge will be validated on first WebDAV request.',
    error: undefined,
    webdavCredentials: existingCredentials,
  }

  return { ...state.session }
}

export function getSessionCookie(): string | null {
  return state.cookie ?? null
}

export function mergeUpstreamCookies(cookieUpdates: string[]): string | null {
  if (cookieUpdates.length === 0) {
    return state.cookie ?? null
  }

  const cookieMap = state.cookie ? parseCookieString(state.cookie) : new Map<string, string>()
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
    return state.cookie ?? null
  }

  const nextCookie = serializeCookieMap(cookieMap)
  state.cookie = nextCookie || undefined
  if (state.session.loggedIn) {
    const accountKey = nextCookie ? extractCookieAccountKey(nextCookie) : null
    const existingCredentials =
      accountKey && state.webdavCredentials?.accountKey === accountKey ? state.webdavCredentials : undefined
    state.session = {
      ...state.session,
      user: nextCookie ? extractCookieUserHint(nextCookie) : state.session.user,
      webdavCredentials: existingCredentials,
    }
  }

  return state.cookie ?? null
}

export function setDriveConnectionState(stateUpdate: {
  driveReady: boolean
  driveStatus: string
  error?: string
}): void {
  state.session = {
    ...state.session,
    driveReady: stateUpdate.driveReady,
    driveStatus: stateUpdate.driveStatus,
    error: stateUpdate.error,
  }
}

export function clearSession(): void {
  state.cookie = undefined
  state.webdavCredentials = undefined
  state.session = createLoggedOutSession()
  state.qrRequests.clear()
}

export async function ensureWebDavCredentialsForCurrentSession(env?: Env): Promise<WebDavCredentials | null> {
  if (!state.session.loggedIn || !state.cookie) {
    return null
  }

  const accountKey = extractCookieAccountKey(state.cookie)
  const credentials = await ensureCredentialsForAccount(accountKey, env)
  state.session = {
    ...state.session,
    webdavCredentials: credentials,
  }
  return credentials
}

export async function getCurrentWebDavCredentials(env?: Env): Promise<WebDavCredentials | null> {
  if (!state.session.loggedIn) {
    return null
  }

  if (state.webdavCredentials) {
    return state.webdavCredentials
  }

  return ensureWebDavCredentialsForCurrentSession(env)
}

export async function rehydrateCurrentSessionFromPersistence(origin: string, env?: Env): Promise<boolean> {
  if (state.session.loggedIn && state.cookie) {
    return true
  }

  const namespace = env?.DAV_CREDENTIALS
  if (!namespace) {
    return false
  }

  const listedKeys = await namespace.list({ prefix: 'quarksession:v1:', limit: 10 })
  const candidateKey = listedKeys.keys.at(0)?.name
  if (!candidateKey) {
    return false
  }

  const accountKey = candidateKey.replace(/^quarksession:v1:/, '')
  const persistedSession = await getPersistedQuarkSessionByAccountKey(accountKey, env)
  if (!persistedSession?.cookie) {
    return false
  }

  state.cookie = persistedSession.cookie
  state.session = {
    loggedIn: true,
    user: persistedSession.user ?? extractCookieUserHint(persistedSession.cookie),
    expiresAt: persistedSession.expiresAt,
    endpoint: createDavEndpoint(origin),
    authType: 'cookie',
    driveReady: false,
    driveStatus: 'Restored persisted Quark session. Upstream bridge will be validated on next access.',
    error: undefined,
  }

  const credentials = await ensureWebDavCredentialsForCurrentSession(env)
  state.session = {
    ...state.session,
    webdavCredentials: credentials ?? undefined,
  }

  return true
}

export async function updateCurrentWebDavCredentials(
  username: string,
  password: string,
  env?: Env,
): Promise<WebDavCredentials | null> {
  const current = await getCurrentWebDavCredentials(env)
  if (!current) {
    return null
  }

  const nextCredentials: WebDavCredentials = {
    ...current,
    username: username.trim(),
    password: password.trim(),
    updatedAt: new Date().toISOString(),
  }

  state.webdavCredentials = nextCredentials
  await persistWebDavCredentials(nextCredentials, env, current.username)
  state.session = {
    ...state.session,
    webdavCredentials: nextCredentials,
  }
  return nextCredentials
}

export async function persistQuarkSessionForCurrentSession(env?: Env): Promise<void> {
  if (!state.session.loggedIn || !state.cookie) {
    return
  }

  const accountKey = extractCookieAccountKey(state.cookie)
  await persistQuarkSessionForAccount(
    accountKey,
    state.cookie,
    {
      user: state.session.user,
      expiresAt: state.session.expiresAt,
    },
    env,
  )
}

export async function persistQuarkSessionForAccount(
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
  if (state.cookie && extractCookieAccountKey(state.cookie) === accountKey) {
    return {
      accountKey,
      cookie: state.cookie,
      user: state.session.user,
      expiresAt: state.session.expiresAt,
      updatedAt: new Date().toISOString(),
    }
  }

  const namespace = env?.DAV_CREDENTIALS
  if (!namespace) {
    return null
  }

  const payload = await namespace.get(getQuarkSessionStorageKey(accountKey), 'json')
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as Partial<PersistedQuarkSession>
  if (typeof record.accountKey !== 'string' || typeof record.cookie !== 'string' || typeof record.updatedAt !== 'string') {
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

export function linkQrRequestToCookieSession(
  requestId: string,
  cookie: string,
  origin: string,
): QrRequestRecord | null {
  const record = state.qrRequests.get(requestId)
  if (!record) {
    return null
  }

  saveCookieSession(cookie, origin)

  const nextRecord: QrRequestRecord = {
    ...record,
    status: 'linked',
    lastError: undefined,
  }

  state.qrRequests.set(requestId, nextRecord)
  return nextRecord
}

export function getSnapshot(origin: string): SessionSnapshot {
  cleanupExpiredQrRequests()

  const activeQrRequest = [...state.qrRequests.values()].at(-1)

  return {
    cookie: state.cookie,
    session: getSessionStatus(origin),
    activeQrRequest,
  }
}

function createLoggedOutSession(): SessionStatus {
  return {
    loggedIn: false,
    authType: undefined,
    driveReady: false,
    driveStatus: 'Waiting for Quark session.',
    error: undefined,
  }
}

function createDavEndpoint(origin: string): string {
  return `${origin}/dav`
}

function cleanupExpiredQrRequests(): void {
  const now = Date.now()

  for (const [requestId, record] of state.qrRequests.entries()) {
    if (new Date(record.expiresAt).getTime() <= now) {
      state.qrRequests.delete(requestId)
    }
  }
}

function trimQrRequests(): void {
  if (state.qrRequests.size <= MAX_QR_REQUESTS) {
    return
  }

  const records = [...state.qrRequests.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )

  for (const record of records.slice(0, state.qrRequests.size - MAX_QR_REQUESTS)) {
    state.qrRequests.delete(record.requestId)
  }
}

function extractCookieUserHint(cookie: string): string {
  const match = cookie.match(/(?:^|;\s*)(?:nickname|user(?:name)?|uid)=([^;]+)/i)
  if (!match) {
    return 'cookie-session'
  }

  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function extractCookieAccountKey(cookie: string): string {
  const match = cookie.match(/(?:^|;\s*)(?:uid|user(?:name)?|nickname)=([^;]+)/i)
  if (!match) {
    return 'quark-session'
  }

  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

async function ensureCredentialsForAccount(accountKey: string, env?: Env): Promise<WebDavCredentials> {
  if (state.webdavCredentials?.accountKey === accountKey) {
    return state.webdavCredentials
  }

  const persistedCredentials = await loadPersistedWebDavCredentials(accountKey, env)
  if (persistedCredentials) {
    state.webdavCredentials = persistedCredentials
    return persistedCredentials
  }

  const now = new Date().toISOString()
  const nextCredentials: WebDavCredentials = {
    accountKey,
    username: generateDefaultUsername(accountKey),
    password: generateRandomPassword(),
    createdAt: now,
    updatedAt: now,
  }

  state.webdavCredentials = nextCredentials
  await persistWebDavCredentials(nextCredentials, env)
  return nextCredentials
}

async function loadPersistedWebDavCredentials(
  accountKey: string,
  env?: Env,
): Promise<WebDavCredentials | null> {
  const namespace = env?.DAV_CREDENTIALS
  if (!namespace) {
    return null
  }

  const payload = await namespace.get(getWebDavCredentialsStorageKey(accountKey), 'json')
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

function getWebDavCredentialsStorageKey(accountKey: string): string {
  return `davcred:v1:${accountKey}`
}

function getWebDavUsernameIndexStorageKey(username: string): string {
  return `davuser:v1:${username}`
}

function getQuarkSessionStorageKey(accountKey: string): string {
  return `quarksession:v1:${accountKey}`
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
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join('')
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
