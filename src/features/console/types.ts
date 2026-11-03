export type SessionStatus = {
  loggedIn: boolean
  accountKey?: string
  accountStatus?: string
  user?: string
  expiresAt?: string
  endpoint?: string
  authType?: string
  driveReady?: boolean
  driveStatus?: string
  error?: string
  webdavCredentials?: {
    username: string
    password: string
  }
}

export type QrStartResponse = {
  requestId?: string
  qrUrl?: string
  qrToken?: string
  expiresAt?: string
  message?: string
}

export type QrStatusResponse = {
  requestId?: string
  status?: string
  qrUrl?: string
  qrToken?: string
  expiresAt?: string
  loggedIn?: boolean
  message?: string
  error?: string
  accountStatus?: string
  webdavCredentials?: {
    username: string
    password: string
  }
}

export type CookieUpdateRequest = {
  cookie: string
}

export type CookieUpdateResponse = {
  updated: boolean
  message?: string
  accountStatus?: string
  webdavCredentials?: {
    username: string
    password: string
  }
}

export type WebDavCredentialsResponse = {
  credentials: {
    username: string
    password: string
  }
}
