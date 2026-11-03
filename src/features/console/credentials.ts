const LOCAL_CREDENTIALS_KEY = 'quark-webdav-credentials'

type LocalWebDavCredentials = {
  username: string
  password: string
}

type InitialCredentialState = LocalWebDavCredentials & {
  hasCache: boolean
}

export function getCachedLocalWebDavCredentials(): LocalWebDavCredentials | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_CREDENTIALS_KEY)
    if (!raw) {
      return null
    }

    const cached = JSON.parse(raw) as { username?: string; password?: string }
    if (
      typeof cached.username !== 'string' ||
      cached.username.length === 0 ||
      typeof cached.password !== 'string' ||
      cached.password.length === 0
    ) {
      return null
    }

    return {
      username: cached.username,
      password: cached.password,
    }
  } catch {
    clearLocalWebDavCredentials()
    return null
  }
}

export function createBasicAuthorizationHeader(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`
}

export function getStoredAuthHeaders(): Record<string, string> | undefined {
  const cached = getCachedLocalWebDavCredentials()
  return cached
    ? { authorization: createBasicAuthorizationHeader(cached.username, cached.password) }
    : undefined
}

export function getInitialCredentialState(): InitialCredentialState {
  const cached = getCachedLocalWebDavCredentials()
  if (!cached) {
    return {
      username: '',
      password: '',
      hasCache: false,
    }
  }

  return {
    username: cached.username,
    password: cached.password,
    hasCache: true,
  }
}

export function persistLocalWebDavCredentials(credentials: LocalWebDavCredentials): void {
  window.localStorage.setItem(LOCAL_CREDENTIALS_KEY, JSON.stringify(credentials))
}

export function clearLocalWebDavCredentials(): void {
  window.localStorage.removeItem(LOCAL_CREDENTIALS_KEY)
}
