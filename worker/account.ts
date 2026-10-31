import { QuarkClient } from './quark/client'
import {
  createAccount,
  ensureCredentialsForAccount,
  findAccountByIdentityKey,
  mergeCookieString,
  saveQuarkSessionForAccount,
  computeSessionExpiry,
  touchAccount,
  type AccountRecord,
  type WebDavCredentials,
} from './session-store'

const ROOT_FID = '0'
export const IDENTITY_FILE_NAME = 'dav-id.txt'
const IDENTITY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,}$/
const IDENTITY_FILE_HEADER =
  '# 此文件是夸克 WebDAV 的身份凭证，请勿分享、转存、修改或删除。\n# quark-webdav identity v1\n'

export class LoginError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'LoginError'
    this.status = status
  }
}

export type LoginOutcome = {
  account: AccountRecord
  credentials: WebDavCredentials
  created: boolean
}

export async function finalizeLogin(inputCookie: string, env: Env): Promise<LoginOutcome> {
  let cookie = inputCookie.trim()
  if (!cookie) {
    throw new LoginError('Cookie input cannot be empty.')
  }

  const client = new QuarkClient(cookie, (cookieUpdates) => {
    cookie = mergeCookieString(cookie, cookieUpdates) ?? cookie
  })

  // Only an explicit "file not found" leads to registration. Read errors abort
  // the login so an existing identity file is never overwritten by mistake.
  const identityEntry = await findIdentityEntry(client)
  let identityKey = identityEntry?.key ?? null
  let account = identityKey ? await findAccountByIdentityKey(identityKey, env) : null
  const profile = await fetchProfile(client)

  let created = false
  if (!account) {
    identityKey = generateIdentityKey()
    await writeIdentityFile(client, identityEntry?.fid ?? null, identityKey)
    account = await createAccount(
      { identityKey, nickname: profile?.nickname, userId: profile?.userId },
      env,
    )
    created = true
  } else if (profile?.nickname || profile?.userId) {
    account =
      (await touchAccount(
        account.accountKey,
        {
          nickname: profile.nickname,
          userId: profile.userId,
          lastLoginAt: new Date().toISOString(),
        },
        env,
      )) ?? account
  }

  await saveQuarkSessionForAccount(
    account.accountKey,
    cookie,
    {
      user: account.nickname,
      expiresAt: computeSessionExpiry(),
    },
    env,
  )

  const credentials = await ensureCredentialsForAccount(account.accountKey, env)
  return { account, credentials, created }
}

export async function tryDeleteIdentityFile(
  cookie: string,
  identityKey: string,
): Promise<boolean> {
  try {
    const client = new QuarkClient(cookie)
    const entry = await client.findEntryByName(ROOT_FID, IDENTITY_FILE_NAME)
    if (!entry || entry.isDirectory) {
      return false
    }

    const key = parseIdentityKey(await client.downloadFileText(entry.fid))
    if (key !== identityKey) {
      return false
    }

    await client.deleteFile(entry.fid)
    return true
  } catch {
    return false
  }
}

type IdentityEntry = {
  fid: string
  key: string | null
}

async function findIdentityEntry(client: QuarkClient): Promise<IdentityEntry | null> {
  const entry = await client.findEntryByName(ROOT_FID, IDENTITY_FILE_NAME)
  if (!entry) {
    return null
  }

  if (entry.isDirectory) {
    throw new LoginError(
      `网盘根目录存在同名文件夹 ${IDENTITY_FILE_NAME}，无法继续。请重命名或删除该文件夹后重试。`,
      409,
    )
  }

  const text = await client.downloadFileText(entry.fid)
  return { fid: entry.fid, key: parseIdentityKey(text) }
}

async function writeIdentityFile(
  client: QuarkClient,
  existingFid: string | null,
  identityKey: string,
): Promise<void> {
  try {
    if (existingFid) {
      await client.deleteFile(existingFid)
    }

    const bytes = new TextEncoder().encode(`${IDENTITY_FILE_HEADER}${identityKey}\n`)
    await client.uploadSmallFile({
      fileName: IDENTITY_FILE_NAME,
      parentFid: ROOT_FID,
      bytes,
      mimeType: 'text/plain',
    })
  } catch (error) {
    throw new LoginError(
      `无法在网盘根目录写入身份文件，注册未完成：${error instanceof Error ? error.message : String(error)}`,
      502,
    )
  }
}

async function fetchProfile(
  client: QuarkClient,
): Promise<{ nickname?: string; userId?: string } | null> {
  try {
    return await client.getAccountInfo()
  } catch {
    return null
  }
}

function parseIdentityKey(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    if (IDENTITY_KEY_PATTERN.test(trimmed)) {
      return trimmed
    }
  }
  return null
}

function generateIdentityKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
