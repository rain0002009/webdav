import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, fetchJson } from '../../lib/api'
import {
  clearLocalWebDavCredentials,
  createBasicAuthorizationHeader,
  getCachedLocalWebDavCredentials,
  getInitialCredentialState,
  getStoredAuthHeaders,
  persistLocalWebDavCredentials,
} from './credentials'
import type {
  CookieUpdateRequest,
  CookieUpdateResponse,
  QrStartResponse,
  QrStatusResponse,
  SessionStatus,
  WebDavCredentialsResponse,
} from './types'

const UNSAFE_WEBDAV_PASSWORD_CHARS = /[%@:/]/

export function useConsoleSession() {
  const initialCredentialState = useMemo(() => getInitialCredentialState(), [])
  const [session, setSession] = useState<SessionStatus | null>(null)
  const [cookieInput, setCookieInput] = useState('')
  const [qrState, setQrState] = useState<QrStartResponse | null>(null)
  const [qrStatus, setQrStatus] = useState<QrStatusResponse | null>(null)

  const [loadingSession, setLoadingSession] = useState(false)
  const [startingQr, setStartingQr] = useState(false)
  const [pollingQr, setPollingQr] = useState(false)
  const [savingCookie, setSavingCookie] = useState(false)
  const [savingWebDavCredentials, setSavingWebDavCredentials] = useState(false)
  const [webdavUsernameInput, setWebdavUsernameInput] = useState(initialCredentialState.username)
  const [webdavPasswordInput, setWebdavPasswordInput] = useState(initialCredentialState.password)
  const [hasLocalCredentialsCache, setHasLocalCredentialsCache] = useState(initialCredentialState.hasCache)

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const qrPollingInFlightRef = useRef(false)

  const handleAuthFailure = useCallback((error: unknown, fallback: string) => {
    if (error instanceof ApiError && error.status === 401) {
      clearLocalWebDavCredentials()
      setHasLocalCredentialsCache(false)
      setWebdavUsernameInput('')
      setWebdavPasswordInput('')
      setSession(null)
      setErrorMessage('登录凭据已失效，本地缓存已清除，请重新扫码或粘贴 Cookie 登录。')
      return
    }
    setErrorMessage(error instanceof Error ? error.message : fallback)
  }, [])

  const webdavEndpoint = session?.endpoint ?? `${window.location.origin}/dav`

  const loadSession = useCallback(async () => {
    setLoadingSession(true)
    setErrorMessage(null)
    try {
      const cachedCredentials = getCachedLocalWebDavCredentials()
      const nextSession = await fetchJson<SessionStatus>('/api/session/status', {
        headers: cachedCredentials
          ? {
              authorization: createBasicAuthorizationHeader(cachedCredentials.username, cachedCredentials.password),
            }
          : undefined,
      })
      setSession(nextSession)
      setWebdavUsernameInput(nextSession.webdavCredentials?.username ?? cachedCredentials?.username ?? '')
      setWebdavPasswordInput(nextSession.webdavCredentials?.password ?? cachedCredentials?.password ?? '')
      if (nextSession.webdavCredentials?.username && nextSession.webdavCredentials?.password) {
        persistLocalWebDavCredentials(nextSession.webdavCredentials)
        setHasLocalCredentialsCache(true)
      }
    } catch (error) {
      handleAuthFailure(error, 'Failed to load status')
    } finally {
      setLoadingSession(false)
    }
  }, [handleAuthFailure])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSession()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [loadSession])

  const onStartQrLogin = useCallback(async () => {
    setStartingQr(true)
    setErrorMessage(null)
    setInfoMessage(null)
    try {
      const nextQrState = await fetchJson<QrStartResponse>('/api/session/qr/start', {
        method: 'POST',
      })
      setQrState(nextQrState)
      setQrStatus(null)
      setInfoMessage(nextQrState.message ?? 'QR login started. Scan to continue.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start QR login')
    } finally {
      setStartingQr(false)
    }
  }, [])

  const pollQrStatus = useCallback(async (options?: { silent?: boolean }) => {
    const requestId = qrState?.requestId ?? qrStatus?.requestId
    if (!requestId) {
      if (!options?.silent) {
        setErrorMessage('No QR request id available. Start QR login first.')
      }
      return
    }

    if (qrPollingInFlightRef.current) {
      return
    }

    qrPollingInFlightRef.current = true

    setPollingQr(true)
    if (!options?.silent) {
      setErrorMessage(null)
      setInfoMessage(null)
    }

    try {
      const nextQrStatus = await fetchJson<QrStatusResponse>(
        `/api/session/qr/status?requestId=${encodeURIComponent(requestId)}`,
      )
      setQrStatus(nextQrStatus)
      if (nextQrStatus.loggedIn) {
        setInfoMessage(nextQrStatus.message ?? 'Login confirmed.')
        if (nextQrStatus.webdavCredentials) {
          persistLocalWebDavCredentials(nextQrStatus.webdavCredentials)
          setHasLocalCredentialsCache(true)
        }
        await loadSession()
      } else if (!options?.silent) {
        setInfoMessage(nextQrStatus.message ?? 'QR status refreshed.')
      }
    } catch (error) {
      if (!options?.silent) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to poll QR status')
      }
    } finally {
      qrPollingInFlightRef.current = false
      setPollingQr(false)
    }
  }, [loadSession, qrState?.requestId, qrStatus?.requestId])

  const onPollQrStatus = useCallback(async () => {
    await pollQrStatus()
  }, [pollQrStatus])

  useEffect(() => {
    const requestId = qrState?.requestId ?? qrStatus?.requestId
    const qrLoggedIn = qrStatus?.loggedIn === true
    const qrExpired = qrStatus?.status === 'expired'
    if (!requestId || qrLoggedIn || qrExpired || session?.loggedIn) {
      return
    }

    const timer = window.setInterval(() => {
      void pollQrStatus({ silent: true })
    }, 3000)

    return () => {
      window.clearInterval(timer)
    }
  }, [pollQrStatus, qrState?.requestId, qrStatus?.loggedIn, qrStatus?.requestId, qrStatus?.status, session?.loggedIn])

  const onSaveCookie = useCallback(async () => {
    const trimmed = cookieInput.trim()
    if (!trimmed) {
      setErrorMessage('Cookie input cannot be empty.')
      return
    }

    setSavingCookie(true)
    setErrorMessage(null)
    setInfoMessage(null)
    try {
      const response = await fetchJson<CookieUpdateResponse>('/api/session/cookie', {
        method: 'POST',
        body: JSON.stringify({ cookie: trimmed } satisfies CookieUpdateRequest),
      })

      if (response.updated) {
        setInfoMessage(response.message ?? 'Cookie session saved successfully.')
        if (response.webdavCredentials) {
          persistLocalWebDavCredentials(response.webdavCredentials)
          setHasLocalCredentialsCache(true)
        }
        await loadSession()
      } else {
        setErrorMessage(response.message ?? 'Cookie was not accepted.')
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save cookie')
    } finally {
      setSavingCookie(false)
    }
  }, [cookieInput, loadSession])

  const onLogout = useCallback(() => {
    clearLocalWebDavCredentials()
    setHasLocalCredentialsCache(false)
    setSession(null)
    setWebdavUsernameInput('')
    setWebdavPasswordInput('')
    setQrState(null)
    setQrStatus(null)
    setCookieInput('')
    setErrorMessage(null)
    setInfoMessage('已退出控制台登录。')
  }, [])

  const onSaveWebDavCredentials = useCallback(async () => {
    const username = webdavUsernameInput.trim()
    const password = webdavPasswordInput.trim()
    if (!username) {
      setErrorMessage('WebDAV 用户名不能为空。')
      return
    }

    if (!password) {
      setErrorMessage('WebDAV 密码不能为空。')
      return
    }

    if (UNSAFE_WEBDAV_PASSWORD_CHARS.test(password)) {
      setErrorMessage('WebDAV 密码不能包含 %, @, :, /，否则某些客户端可能出现 URI malformed。')
      return
    }

    setSavingWebDavCredentials(true)
    setErrorMessage(null)
    setInfoMessage(null)
    try {
      const response = await fetchJson<WebDavCredentialsResponse>('/api/session/webdav-credentials', {
        method: 'POST',
        headers: getStoredAuthHeaders(),
        body: JSON.stringify({ username, password }),
      })
      setWebdavUsernameInput(response.credentials.username)
      setWebdavPasswordInput(response.credentials.password)
      persistLocalWebDavCredentials(response.credentials)
      setHasLocalCredentialsCache(true)
      setInfoMessage('WebDAV 用户名和密码已更新。')
      await loadSession()
    } catch (error) {
      handleAuthFailure(error, '更新 WebDAV 凭据失败')
    } finally {
      setSavingWebDavCredentials(false)
    }
  }, [handleAuthFailure, loadSession, webdavPasswordInput, webdavUsernameInput])

  const isBusy =
    loadingSession || startingQr || pollingQr || savingCookie || savingWebDavCredentials

  return {
    session,
    cookieInput,
    setCookieInput,
    qrState,
    qrStatus,
    loadingSession,
    startingQr,
    pollingQr,
    savingCookie,
    savingWebDavCredentials,
    webdavUsernameInput,
    setWebdavUsernameInput,
    webdavPasswordInput,
    setWebdavPasswordInput,
    hasLocalCredentialsCache,
    errorMessage,
    infoMessage,
    webdavEndpoint,
    loadSession,
    onStartQrLogin,
    onPollQrStatus,
    onSaveCookie,
    onLogout,
    onSaveWebDavCredentials,
    isBusy,
  }
}
