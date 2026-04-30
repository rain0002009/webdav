import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import './App.css'

const LOCAL_CREDENTIALS_KEY = 'quark-webdav-credentials'

type ApiEnvelope<T> = {
  ok?: boolean
  success?: boolean
  message?: string
  error?: string
  data?: T
}

type SessionStatus = {
  loggedIn: boolean
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

type QrStartResponse = {
  requestId?: string
  qrUrl?: string
  qrToken?: string
  expiresAt?: string
  message?: string
}

type QrStatusResponse = {
  requestId?: string
  status?: string
  qrUrl?: string
  qrToken?: string
  expiresAt?: string
  loggedIn?: boolean
  message?: string
  error?: string
}

type CookieUpdateRequest = {
  cookie: string
}

type CookieUpdateResponse = {
  updated: boolean
  message?: string
}

type WebDavCredentialsResponse = {
  credentials: {
    username: string
    password: string
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  const payload = (await response.json().catch(() => null)) as
    | ApiEnvelope<T>
    | T
    | null

  const envelope = payload as ApiEnvelope<T> | null
  const hasData = envelope !== null && typeof envelope === 'object' && 'data' in envelope
  const failed =
    !response.ok ||
    envelope?.ok === false ||
    envelope?.success === false ||
    Boolean(envelope?.error)

  if (failed) {
    const message =
      envelope?.error ??
      envelope?.message ??
      `Request failed (${response.status})`
    throw new Error(message)
  }

  if (hasData) {
    return (envelope as ApiEnvelope<T>).data as T
  }

  return payload as T
}

function App() {
  const [session, setSession] = useState<SessionStatus | null>(null)
  const [cookieInput, setCookieInput] = useState('')
  const [qrState, setQrState] = useState<QrStartResponse | null>(null)
  const [qrStatus, setQrStatus] = useState<QrStatusResponse | null>(null)

  const [loadingSession, setLoadingSession] = useState(false)
  const [startingQr, setStartingQr] = useState(false)
  const [pollingQr, setPollingQr] = useState(false)
  const [savingCookie, setSavingCookie] = useState(false)
  const [savingWebDavCredentials, setSavingWebDavCredentials] = useState(false)
  const [clearingSession, setClearingSession] = useState(false)
  const [webdavUsernameInput, setWebdavUsernameInput] = useState('')
  const [webdavPasswordInput, setWebdavPasswordInput] = useState('')
  const [hasLocalCredentialsCache, setHasLocalCredentialsCache] = useState(false)

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const qrPollingInFlightRef = useRef(false)

  const webdavEndpoint = useMemo(() => {
    if (session?.endpoint) {
      return session.endpoint
    }
    return `${window.location.origin}/dav`
  }, [session?.endpoint])

  const loadSession = useCallback(async () => {
    setLoadingSession(true)
    setErrorMessage(null)
    try {
      const nextSession = await fetchJson<SessionStatus>('/api/session/status')
      setSession(nextSession)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load status')
    } finally {
      setLoadingSession(false)
    }
  }, [])

  useEffect(() => {
    void loadSession()
  }, [loadSession])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LOCAL_CREDENTIALS_KEY)
      if (!raw) {
        return
      }

      const cached = JSON.parse(raw) as { username?: string; password?: string }
      if (typeof cached.username === 'string' && cached.username.length > 0) {
        setWebdavUsernameInput(cached.username)
        setHasLocalCredentialsCache(true)
      }

      if (typeof cached.password === 'string' && cached.password.length > 0) {
        setWebdavPasswordInput(cached.password)
        setHasLocalCredentialsCache(true)
      }
    } catch {
      window.localStorage.removeItem(LOCAL_CREDENTIALS_KEY)
    }
  }, [])

  useEffect(() => {
    setWebdavUsernameInput(session?.webdavCredentials?.username ?? '')
    setWebdavPasswordInput(session?.webdavCredentials?.password ?? '')
    if (session?.webdavCredentials?.username && session?.webdavCredentials?.password) {
      window.localStorage.setItem(
        LOCAL_CREDENTIALS_KEY,
        JSON.stringify({
          username: session.webdavCredentials.username,
          password: session.webdavCredentials.password,
        }),
      )
      setHasLocalCredentialsCache(true)
    }
  }, [session?.webdavCredentials?.username, session?.webdavCredentials?.password])

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

  const onClearSession = useCallback(async () => {
    setClearingSession(true)
    setErrorMessage(null)
    setInfoMessage(null)
    try {
      await fetchJson<{ cleared?: boolean; message?: string }>('/api/session/logout', {
        method: 'POST',
      })
      setQrState(null)
      setQrStatus(null)
      setCookieInput('')
      window.localStorage.removeItem(LOCAL_CREDENTIALS_KEY)
      setHasLocalCredentialsCache(false)
      setInfoMessage('Session cleared.')
      await loadSession()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to clear session')
    } finally {
      setClearingSession(false)
    }
  }, [loadSession])

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

    setSavingWebDavCredentials(true)
    setErrorMessage(null)
    setInfoMessage(null)
    try {
      const response = await fetchJson<WebDavCredentialsResponse>('/api/session/webdav-credentials', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      setWebdavUsernameInput(response.credentials.username)
      setWebdavPasswordInput(response.credentials.password)
      window.localStorage.setItem(
        LOCAL_CREDENTIALS_KEY,
        JSON.stringify({
          username: response.credentials.username,
          password: response.credentials.password,
        }),
      )
      setHasLocalCredentialsCache(true)
      setInfoMessage('WebDAV 用户名和密码已更新。')
      await loadSession()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '更新 WebDAV 凭据失败')
    } finally {
      setSavingWebDavCredentials(false)
    }
  }, [loadSession, webdavPasswordInput, webdavUsernameInput])

  const isBusy =
    loadingSession || startingQr || pollingQr || savingCookie || savingWebDavCredentials || clearingSession

  const qrRequestId = qrStatus?.requestId ?? qrState?.requestId
  const qrUrl = qrStatus?.qrUrl ?? qrState?.qrUrl
  const qrToken = qrStatus?.qrToken ?? qrState?.qrToken
  const qrExpiresAt = qrStatus?.expiresAt ?? qrState?.expiresAt
  const qrCurrentStatus = qrStatus?.status
  const qrError = qrStatus?.error
  const hasQrPayload = Boolean(qrUrl || qrToken || qrRequestId)
  const qrValue = qrUrl ?? qrToken ?? ''
  const qrCanRender = qrValue.length > 0

  return (
    <main className="panel">
      <header className="panel__header">
        <h1>夸克网盘 WebDAV 控制台</h1>
        <p className="panel__subtitle">用于管理 Worker 桥接会话与登录状态</p>
      </header>

      {errorMessage ? (
        <div className="notice notice--error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      {infoMessage ? <div className="notice notice--info">{infoMessage}</div> : null}

      <section className="card">
        <div className="card__header">
          <h2>连接与会话状态</h2>
          <button className="button button--ghost" onClick={() => void loadSession()} disabled={isBusy}>
            {loadingSession ? '刷新中...' : '刷新状态'}
          </button>
        </div>
        <dl className="kv-grid">
          <div>
            <dt>WebDAV 地址</dt>
            <dd>
              <code>{webdavEndpoint}</code>
            </dd>
          </div>
          <div>
            <dt>认证状态</dt>
            <dd>{session?.loggedIn ? '已登录' : '未登录'}</dd>
          </div>
          <div>
            <dt>会话过期时间</dt>
            <dd>{session?.expiresAt ?? '-'}</dd>
          </div>
          <div>
            <dt>网盘状态</dt>
            <dd>{session?.driveStatus ?? '-'}</dd>
          </div>
          <div>
            <dt>网盘错误</dt>
            <dd>{session?.error ?? '-'}</dd>
          </div>
        </dl>
      </section>

      <section className="card">
        <div className="card__header">
          <h2>WebDAV 凭据</h2>
          <button className="button" onClick={onSaveWebDavCredentials} disabled={isBusy || !session?.loggedIn}>
            {savingWebDavCredentials ? '保存中...' : '保存凭据'}
          </button>
        </div>

        {session?.loggedIn ? (
          <>
            <p className="card__footnote">
              当前登录的夸克账户会自动绑定一组 WebDAV 用户名和密码。这里显示的是当前有效凭据，你可以直接修改并保存。
            </p>
            <div className="credentials-grid">
              <label className="field credentials-grid__field" htmlFor="webdav-username-input">
                <span>WebDAV 用户名</span>
                <input
                  id="webdav-username-input"
                  type="text"
                  value={webdavUsernameInput}
                  onChange={(event) => setWebdavUsernameInput(event.target.value)}
                  disabled={isBusy}
                />
              </label>
              <label className="field credentials-grid__field" htmlFor="webdav-password-input">
                <span>WebDAV 密码</span>
                <input
                  id="webdav-password-input"
                  type="text"
                  value={webdavPasswordInput}
                  onChange={(event) => setWebdavPasswordInput(event.target.value)}
                  disabled={isBusy}
                />
              </label>
            </div>
          </>
        ) : hasLocalCredentialsCache ? (
          <>
            <p className="card__footnote">
              这里显示的是当前浏览器本地缓存的上一组 WebDAV 凭据，方便你刷新页面后继续查看。真正使用前，仍需要先恢复对应的夸克登录状态。
            </p>
            <div className="credentials-grid credentials-grid--readonly">
              <label className="field credentials-grid__field" htmlFor="webdav-username-input">
                <span>本地缓存的 WebDAV 用户名</span>
                <input id="webdav-username-input" type="text" value={webdavUsernameInput} disabled />
              </label>
              <label className="field credentials-grid__field" htmlFor="webdav-password-input">
                <span>本地缓存的 WebDAV 密码</span>
                <input id="webdav-password-input" type="text" value={webdavPasswordInput} disabled />
              </label>
            </div>
          </>
        ) : (
          <p className="card__footnote">请先完成夸克登录。登录成功后，系统会自动为当前夸克账户生成一组 WebDAV 用户名和密码。</p>
        )}
      </section>

      {!session?.loggedIn ? (
        <>
          <section className="card">
            <div className="card__header">
              <h2>二维码登录</h2>
              <div className="card__actions">
                <button className="button" onClick={onStartQrLogin} disabled={isBusy}>
                  {startingQr ? '启动中...' : '开始二维码登录'}
                </button>
                <button className="button button--ghost" onClick={onPollQrStatus} disabled={isBusy}>
                  {pollingQr ? '查询中...' : '查询扫码状态'}
                </button>
              </div>
            </div>

            <div className="qr-layout">
              <article className="qr-visual" aria-live="polite">
                {qrCanRender ? (
                  <>
                    <div className="qr-visual__badge">可扫码二维码</div>
                    <div className="qr-code-frame">
                      <QRCodeSVG
                        value={qrValue}
                        size={176}
                        marginSize={3}
                        bgColor="transparent"
                        fgColor="currentColor"
                        className="qr-code-svg"
                      />
                    </div>
                    <p className="qr-visual__hint">
                      这是根据当前后端真实返回的链接/令牌生成的二维码。你现在至少可以扫码看到对应内容，但这不代表后端已经打通真实夸克扫码登录回调。
                    </p>
                    {qrUrl ? (
                      <a
                        className="qr-visual__link"
                        href={qrUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={qrUrl}
                      >
                        在新窗口打开扫码链接
                      </a>
                    ) : null}
                    <div className="qr-visual__url" title={qrValue}>
                      {qrValue}
                    </div>
                  </>
                ) : hasQrPayload ? (
                  <>
                    <div className="qr-visual__badge">已收到登录上下文</div>
                    <p className="qr-visual__hint">已拿到请求标识或令牌，但当前数据还不足以生成二维码。请继续点击“查询扫码状态”确认登录进度。</p>
                  </>
                ) : (
                  <>
                    <div className="qr-visual__placeholder" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                    <p className="qr-visual__hint">点击“开始二维码登录”后，若后端仅返回链接或令牌，这里会展示真实返回内容与限制说明。</p>
                  </>
                )}
              </article>

              <dl className="kv-grid kv-grid--qr">
                <div>
                  <dt>请求 ID</dt>
                  <dd>{qrRequestId ?? '-'}</dd>
                </div>
                <div>
                  <dt>二维码状态</dt>
                  <dd>{qrCurrentStatus ?? '-'}</dd>
                </div>
                <div>
                  <dt>二维码链接</dt>
                  <dd className="truncate">{qrUrl ?? '-'}</dd>
                </div>
                <div>
                  <dt>二维码令牌</dt>
                  <dd className="truncate">{qrToken ?? '-'}</dd>
                </div>
                <div>
                  <dt>失效时间</dt>
                  <dd>{qrExpiresAt ?? '-'}</dd>
                </div>
                <div>
                  <dt>最近错误</dt>
                  <dd>{qrError ?? '-'}</dd>
                </div>
              </dl>
            </div>

            <p className="card__footnote">说明：页面现在会把后端返回的链接或令牌渲染成可扫码二维码，但真实夸克扫码成功回调仍未接通；如果扫码后没有自动登录，这不是你的操作问题，而是后端链路还在开发中。</p>
          </section>

          <section className="card">
            <div className="card__header">
              <h2>手动 Cookie 兜底</h2>
              <button className="button" onClick={onSaveCookie} disabled={isBusy}>
                {savingCookie ? '保存中...' : '保存 Cookie'}
              </button>
            </div>
            <label className="field" htmlFor="cookie-input">
              Cookie 字符串
            </label>
            <textarea
              id="cookie-input"
              value={cookieInput}
              onChange={(event) => setCookieInput(event.target.value)}
              rows={4}
              placeholder="粘贴完整 Cookie Header 值"
              disabled={isBusy}
            />
          </section>
        </>
      ) : null}

      <section className="card card--danger">
        <div className="card__header">
          <h2>会话清理</h2>
          <button className="button button--danger" onClick={onClearSession} disabled={isBusy}>
            {clearingSession ? '清理中...' : '清理会话'}
          </button>
        </div>
        <p>会清空 Worker 当前认证/会话状态，清理后需要重新登录。</p>
      </section>
    </main>
  )
}

export default App
