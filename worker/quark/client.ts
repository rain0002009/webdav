import { QuarkApiError, type QuarkDownloadLink, type QuarkEntry } from './types'

const QUARK_API_BASE = 'https://drive-pc.quark.cn'
const QUARK_LOGIN_API_BASE = 'https://uop.quark.cn'
const QUARK_PAN_API_BASE = 'https://pan.quark.cn'
const DEFAULT_QUERY = {
  pr: 'ucpro',
  fr: 'pc',
  uc_param_str: '',
} as const
const DEFAULT_LOGIN_QUERY = {
  client_id: '532',
  v: '1.2',
} as const

const DEFAULT_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'content-type': 'application/json',
  origin: 'https://pan.quark.cn',
  referer: 'https://pan.quark.cn/',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.56 Chrome/100.0.4896.160 Electron/18.3.5.12 Safari/537.36',
} satisfies HeadersInit

type QuarkListEnvelope = {
  code?: number
  status?: number
  message?: string
  error?: string
  data?: {
    list?: QuarkRawEntry[]
  }
}

type QuarkDownloadEnvelope = {
  code?: number
  status?: number
  message?: string
  error?: string
  data?: Array<{
    download_url?: string
    expires_at?: number
  }>
}

type QuarkRawEntry = {
  fid?: string
  pdir_fid?: string
  file_name?: string
  size?: number
  dir?: boolean
  updated_at?: string
  obj_category?: string
  format_type?: string
}

type QuarkQrTokenEnvelope = {
  status?: number
  message?: string
  data?: {
    members?: {
      token?: string
    }
  }
}

type QuarkQrStatusEnvelope = {
  status?: number
  message?: string
  data?: {
    members?: {
      service_ticket?: string
    }
  }
}

export class QuarkClient {
  private readonly cookie: string
  private readonly onCookiesUpdated?: (cookieUpdates: string[]) => void

  constructor(cookie: string, onCookiesUpdated?: (cookieUpdates: string[]) => void) {
    this.cookie = cookie
    this.onCookiesUpdated = onCookiesUpdated
  }

  async listDirectory(parentFid: string): Promise<QuarkEntry[]> {
    const url = new URL('/1/clouddrive/file/sort', QUARK_API_BASE)
    for (const [key, value] of Object.entries({
      ...DEFAULT_QUERY,
      pdir_fid: parentFid,
      _page: '1',
      _size: '200',
      _fetch_total: '1',
      _fetch_sub_dirs: '1',
      _sort: 'file_type:asc,updated_at:desc',
    })) {
      url.searchParams.set(key, value)
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: this.createHeaders(),
    })
    this.captureCookieUpdates(response)

    const payload = (await response.json().catch(() => null)) as QuarkListEnvelope | null
    if (!response.ok) {
      throw new QuarkApiError(this.getErrorMessage(payload, response.status), response.status, payload?.code)
    }

    if ((payload?.code ?? 0) !== 0 && payload?.status !== 200) {
      throw new QuarkApiError(this.getErrorMessage(payload, response.status), response.status, payload?.code)
    }

    return (payload?.data?.list ?? [])
      .filter((item): item is Required<Pick<QuarkRawEntry, 'fid' | 'file_name'>> & QuarkRawEntry =>
        typeof item.fid === 'string' && item.fid.length > 0 && typeof item.file_name === 'string',
      )
      .map((item) => ({
        fid: item.fid,
        parentFid: item.pdir_fid ?? parentFid,
        name: item.file_name,
        isDirectory: item.dir === true,
        size: typeof item.size === 'number' ? item.size : 0,
        updatedAt: item.updated_at,
        contentType: inferContentType(item),
      }))
  }

  async getDownloadUrl(fid: string): Promise<QuarkDownloadLink> {
    const url = new URL('/1/clouddrive/file/download', QUARK_API_BASE)
    for (const [key, value] of Object.entries(DEFAULT_QUERY)) {
      url.searchParams.set(key, value)
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify({ fids: [fid] }),
    })
    this.captureCookieUpdates(response)

    const payload = (await response.json().catch(() => null)) as QuarkDownloadEnvelope | null
    if (!response.ok) {
      throw new QuarkApiError(this.getErrorMessage(payload, response.status), response.status, payload?.code)
    }

    if ((payload?.code ?? 0) !== 0 && payload?.status !== 200) {
      throw new QuarkApiError(this.getErrorMessage(payload, response.status), response.status, payload?.code)
    }

    const downloadItem = payload?.data?.[0]
    const downloadUrl = downloadItem?.download_url
    if (!downloadUrl) {
      throw new QuarkApiError('Quark did not return a download URL for this file.', 502)
    }

    return {
      url: downloadUrl,
      expiresAt: parseDownloadUrlExpiresAt(downloadUrl, downloadItem?.expires_at),
    }
  }

  async getTokenForQrcodeLogin(): Promise<{ qrToken: string; qrUrl: string; expiresAt: string }> {
    const requestId = crypto.randomUUID()
    const url = new URL('/cas/ajax/getTokenForQrcodeLogin', QUARK_LOGIN_API_BASE)
    for (const [key, value] of Object.entries({
      ...DEFAULT_LOGIN_QUERY,
      request_id: requestId,
    })) {
      url.searchParams.set(key, value)
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: this.createHeaders(),
    })
    this.captureCookieUpdates(response)

    const payload = (await response.json().catch(() => null)) as QuarkQrTokenEnvelope | null
    if (!response.ok || payload?.status !== 2000000 || payload?.message !== 'ok') {
      throw new QuarkApiError(this.getErrorMessage(payload, response.status), response.status)
    }

    const qrToken = payload?.data?.members?.token
    if (!qrToken) {
      throw new QuarkApiError('Quark did not return a QR login token.', 502)
    }

    const qrUrl = new URL('https://su.quark.cn/4_eMHBJ')
    for (const [key, value] of Object.entries({
      token: qrToken,
      client_id: '532',
      ssb: 'weblogin',
      uc_param_str: '',
      uc_biz_str: 'S:custom|OPT:SAREA@0|OPT:IMMERSIVE@1|OPT:BACK_BTN_STYLE@0',
    })) {
      qrUrl.searchParams.set(key, value)
    }

    return {
      qrToken,
      qrUrl: qrUrl.toString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }
  }

  async getServiceTicketByQrcodeToken(
    qrToken: string,
  ): Promise<{ status: 'pending' | 'confirmed' | 'expired'; serviceTicket?: string; error?: string }> {
    const requestId = crypto.randomUUID()
    const url = new URL('/cas/ajax/getServiceTicketByQrcodeToken', QUARK_LOGIN_API_BASE)
    for (const [key, value] of Object.entries({
      ...DEFAULT_LOGIN_QUERY,
      token: qrToken,
      request_id: requestId,
    })) {
      url.searchParams.set(key, value)
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: this.createHeaders(),
    })
    this.captureCookieUpdates(response)

    const payload = (await response.json().catch(() => null)) as QuarkQrStatusEnvelope | null
    if (!response.ok) {
      throw new QuarkApiError(this.getErrorMessage(payload, response.status), response.status)
    }

    const status = payload?.status
    const message = payload?.message ?? 'Unknown Quark QR status.'
    const serviceTicket = payload?.data?.members?.service_ticket
    if (status === 2000000 && message === 'ok' && serviceTicket) {
      return {
        status: 'confirmed',
        serviceTicket,
      }
    }

    if (status === 50004001) {
      return {
        status: 'pending',
      }
    }

    if (status === 50004002 || status === 50004003 || status === 50004004) {
      return {
        status: 'expired',
        error: message,
      }
    }

    return {
      status: 'pending',
      error: message,
    }
  }

  async getAccountInfoByServiceTicket(serviceTicket: string): Promise<string> {
    const url = new URL('/account/info', QUARK_PAN_API_BASE)
    url.searchParams.set('st', serviceTicket)
    url.searchParams.set('lw', 'scan')

    const response = await fetch(url, {
      method: 'GET',
      headers: this.createHeaders(),
      redirect: 'follow',
    })
    this.captureCookieUpdates(response)

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string; error?: string } | null
      throw new QuarkApiError(this.getErrorMessage(payload, response.status), response.status)
    }

    const cookieUpdates = getResponseSetCookies(response)
    if (cookieUpdates.length > 0) {
      this.onCookiesUpdated?.(cookieUpdates)
    }

    return response.url
  }

  private createHeaders(): HeadersInit {
    return {
      ...DEFAULT_HEADERS,
      cookie: this.cookie,
    }
  }

  private getErrorMessage(payload: { error?: string; message?: string } | null, status: number): string {
    return payload?.error ?? payload?.message ?? `Quark upstream request failed (${status}).`
  }

  private captureCookieUpdates(response: Response): void {
    if (!this.onCookiesUpdated) {
      return
    }

    const cookieUpdates = getResponseSetCookies(response)
    if (cookieUpdates.length === 0) {
      return
    }

    this.onCookiesUpdated(cookieUpdates)
  }
}

function inferContentType(entry: QuarkRawEntry): string {
  if (entry.dir === true) {
    return 'httpd/unix-directory'
  }

  if (entry.obj_category === 'video') {
    return 'video/mp4'
  }

  if (entry.obj_category === 'image') {
    return 'image/*'
  }

  if (entry.format_type) {
    return entry.format_type
  }

  return 'application/octet-stream'
}

function parseDownloadUrlExpiresAt(downloadUrl: string, fallbackEpochSeconds?: number): number | undefined {
  try {
    const url = new URL(downloadUrl)
    const expires = url.searchParams.get('Expires')
    if (expires) {
      const parsed = Number(expires)
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed * 1000
      }
    }
  } catch {
    // Ignore malformed upstream URLs and fall back to payload metadata.
  }

  if (typeof fallbackEpochSeconds === 'number' && Number.isFinite(fallbackEpochSeconds)) {
    return fallbackEpochSeconds * 1000
  }

  return undefined
}

function getResponseSetCookies(response: Response): string[] {
  const headersWithGetSetCookie = response.headers as Headers & {
    getSetCookie?: () => string[]
  }

  if (typeof headersWithGetSetCookie.getSetCookie === 'function') {
    return headersWithGetSetCookie.getSetCookie().filter(Boolean)
  }

  const combined = response.headers.get('set-cookie')
  if (!combined) {
    return []
  }

  return splitCombinedSetCookieHeader(combined)
}

function splitCombinedSetCookieHeader(headerValue: string): string[] {
  const cookies: string[] = []
  let current = ''
  let inExpiresAttribute = false

  for (let index = 0; index < headerValue.length; index += 1) {
    const char = headerValue[index]

    if (char === ',') {
      if (inExpiresAttribute) {
        current += char
        continue
      }

      const nextSlice = headerValue.slice(index + 1)
      if (/^\s*[^=;,\s]+=/u.test(nextSlice)) {
        const trimmed = current.trim()
        if (trimmed) {
          cookies.push(trimmed)
        }
        current = ''
        continue
      }
    }

    current += char

    if (current.toLowerCase().endsWith('expires=')) {
      inExpiresAttribute = true
    } else if (inExpiresAttribute && char === ';') {
      inExpiresAttribute = false
    }
  }

  const trimmed = current.trim()
  if (trimmed) {
    cookies.push(trimmed)
  }

  return cookies
}
