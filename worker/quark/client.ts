import { QuarkApiError, type QuarkDownloadLink, type QuarkEntry, type QuarkUploadTicket } from './types'

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

type QuarkCreateDirectoryEnvelope = {
  code?: number
  status?: number
  message?: string
  data?: {
    finish?: boolean
    fid?: string
  }
}

type QuarkDeleteEnvelope = {
  code?: number
  status?: number
  message?: string
}

type QuarkUploadPreEnvelope = {
  code?: number
  status?: number
  message?: string
  data?: {
    finish?: boolean
    task_id?: string
    upload_id?: string
    auth_info?: string
    upload_url?: string
    obj_key?: string
    fid?: string
    bucket?: string
    format_type?: string
    callback?: {
      callbackUrl?: string
      callbackBody?: string
    }
  }
  metadata?: {
    part_size?: number
  }
}

type QuarkUploadHashEnvelope = {
  code?: number
  status?: number
  message?: string
  data?: {
    finish?: boolean
  }
}

type QuarkAuthEnvelope = {
  code?: number
  status?: number
  message?: string
  data?: {
    auth_key?: string
  }
}

type QuarkFinishEnvelope = {
  code?: number
  status?: number
  message?: string
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

  async createDirectory(parentFid: string, name: string): Promise<void> {
    const url = new URL('/1/clouddrive/file', QUARK_API_BASE)
    for (const [key, value] of Object.entries(DEFAULT_QUERY)) {
      url.searchParams.set(key, value)
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify({
        pdir_fid: parentFid,
        file_name: name,
        dir_path: '',
        dir_init_lock: false,
      }),
    })
    this.captureCookieUpdates(response)

    const payload = (await response.json().catch(() => null)) as QuarkCreateDirectoryEnvelope | null
    if (!response.ok || payload?.status !== 200) {
      throw new QuarkApiError(this.getErrorMessage(payload, response.status), response.status)
    }
  }

  async deleteFile(fileId: string): Promise<void> {
    const url = new URL('/1/clouddrive/file/delete', QUARK_API_BASE)
    for (const [key, value] of Object.entries(DEFAULT_QUERY)) {
      url.searchParams.set(key, value)
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify({
        action_type: 2,
        exclude_fids: [],
        filelist: [fileId],
      }),
    })
    this.captureCookieUpdates(response)

    const payload = (await response.json().catch(() => null)) as QuarkDeleteEnvelope | null
    if (!response.ok || payload?.status !== 200) {
      throw new QuarkApiError(this.getErrorMessage(payload, response.status), response.status)
    }
  }

  async renameFile(fileId: string, name: string): Promise<void> {
    const url = new URL('/1/clouddrive/file/rename', QUARK_API_BASE)
    for (const [key, value] of Object.entries(DEFAULT_QUERY)) {
      url.searchParams.set(key, value)
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify({
        fid: fileId,
        file_name: name,
      }),
    })
    this.captureCookieUpdates(response)

    const payload = (await response.json().catch(() => null)) as QuarkDeleteEnvelope | null
    if (!response.ok || payload?.status !== 200) {
      throw new QuarkApiError(this.getErrorMessage(payload, response.status), response.status)
    }
  }

  async moveFile(fileId: string, targetParentFid: string): Promise<void> {
    const url = new URL('/1/clouddrive/file/move', QUARK_API_BASE)
    for (const [key, value] of Object.entries(DEFAULT_QUERY)) {
      url.searchParams.set(key, value)
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify({
        filelist: [fileId],
        to_pdir_fid: targetParentFid,
      }),
    })
    this.captureCookieUpdates(response)

    const payload = (await response.json().catch(() => null)) as QuarkDeleteEnvelope | null
    if (!response.ok || payload?.status !== 200) {
      throw new QuarkApiError(this.getErrorMessage(payload, response.status), response.status)
    }
  }

  async prepareUpload(fileName: string, size: number, parentFid: string, mimeType: string): Promise<QuarkUploadTicket> {
    const url = new URL('/1/clouddrive/file/upload/pre', QUARK_API_BASE)
    for (const [key, value] of Object.entries(DEFAULT_QUERY)) {
      url.searchParams.set(key, value)
    }

    const now = Date.now()
    const response = await fetch(url, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify({
        file_name: fileName,
        size,
        pdir_fid: parentFid,
        format_type: mimeType,
        ccp_hash_update: true,
        l_created_at: now,
        l_updated_at: now,
        parallel_upload: false,
        dir_name: '',
      }),
    })
    this.captureCookieUpdates(response)

    const payload = (await response.json().catch(() => null)) as QuarkUploadPreEnvelope | null
    if (!response.ok || payload?.status !== 200) {
      throw new QuarkApiError(this.getErrorMessage(payload, response.status), response.status)
    }

    const data = payload?.data
    if (
      !data?.task_id ||
      !data?.auth_info ||
      !data?.upload_url ||
      !data?.obj_key ||
      !data?.bucket ||
      !data?.fid ||
      !payload?.metadata?.part_size
    ) {
      throw new QuarkApiError('Quark upload preflight response was incomplete.', 502)
    }

    return {
      taskId: data.task_id,
      uploadId: data.upload_id ?? '',
      uploadUrl: stripProtocol(data.upload_url),
      bucket: data.bucket,
      objectKey: data.obj_key,
      authInfo: data.auth_info,
      callback: {
        callbackUrl: data.callback?.callbackUrl ?? '',
        callbackBody: data.callback?.callbackBody ?? '',
      },
      partSize: payload.metadata.part_size,
      mimeType: data.format_type || mimeType,
      fileId: data.fid,
      alreadyFinished: data.finish === true,
    }
  }

  async updateUploadHash(md5: string, sha1: string, taskId: string): Promise<boolean> {
    const url = new URL('/1/clouddrive/file/update/hash', QUARK_API_BASE)
    for (const [key, value] of Object.entries(DEFAULT_QUERY)) {
      url.searchParams.set(key, value)
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify({
        md5,
        sha1,
        task_id: taskId,
      }),
    })
    this.captureCookieUpdates(response)

    const payload = (await response.json().catch(() => null)) as QuarkUploadHashEnvelope | null
    if (!response.ok || payload?.status !== 200) {
      throw new QuarkApiError(this.getErrorMessage(payload, response.status), response.status)
    }

    return payload?.data?.finish === true
  }

  async authenticateUpload(authInfo: string, authMeta: string, taskId: string): Promise<string> {
    const url = new URL('/1/clouddrive/file/upload/auth', QUARK_API_BASE)
    for (const [key, value] of Object.entries(DEFAULT_QUERY)) {
      url.searchParams.set(key, value)
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify({
        auth_info: authInfo,
        auth_meta: authMeta,
        task_id: taskId,
      }),
    })
    this.captureCookieUpdates(response)

    const payload = (await response.json().catch(() => null)) as QuarkAuthEnvelope | null
    if (!response.ok || payload?.status !== 200 || !payload?.data?.auth_key) {
      throw new QuarkApiError(this.getErrorMessage(payload, response.status), response.status)
    }

    return payload.data.auth_key
  }

  async uploadSinglePart(args: {
    authKey: string
    mimeType: string
    utcTime: string
    bucket: string
    uploadUrl: string
    objectKey: string
    uploadId: string
    bytes: Uint8Array
  }): Promise<string> {
    const url = `https://${args.bucket}.${args.uploadUrl}//${args.objectKey}?partNumber=1&uploadId=${args.uploadId}`
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: args.authKey,
        'Content-Type': args.mimeType,
        'x-oss-date': args.utcTime,
        'x-oss-user-agent': 'aliyun-sdk-js/6.6.1 Chrome 98.0.4758.80 on Windows 10 64-bit',
        Referer: 'https://pan.quark.cn/',
      },
      body: args.bytes,
    })

    if (!response.ok) {
      throw new QuarkApiError(`Quark upload part failed (${response.status}).`, response.status)
    }

    const etag = response.headers.get('etag')
    if (!etag) {
      throw new QuarkApiError('Quark upload part did not return an ETag.', 502)
    }

    return etag
  }

  async commitSinglePartUpload(args: {
    etag: string
    callback: { callbackUrl: string; callbackBody: string }
    bucket: string
    objectKey: string
    uploadId: string
    authInfo: string
    taskId: string
    uploadUrl: string
  }): Promise<void> {
    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUpload>\n<Part>\n<PartNumber>1</PartNumber>\n<ETag>${args.etag}</ETag>\n</Part>\n</CompleteMultipartUpload>`
    const contentMd5 = await digestToBase64('MD5', new TextEncoder().encode(xmlBody))
    const callbackBase64 = toBase64(JSON.stringify(args.callback))
    const time = new Date().toUTCString()
    const authMeta = [
      'POST',
      contentMd5,
      'application/xml',
      time,
      `x-oss-callback:${callbackBase64}`,
      `x-oss-date:${time}`,
      'x-oss-user-agent:aliyun-sdk-js/6.6.1 Chrome 98.0.4758.80 on Windows 10 64-bit',
      `/${args.bucket}/${args.objectKey}?uploadId=${args.uploadId}`,
    ].join('\n')
    const authKey = await this.authenticateUpload(args.authInfo, authMeta, args.taskId)

    const commitUrl = `https://${args.bucket}.${args.uploadUrl}//${args.objectKey}?uploadId=${args.uploadId}`
    const response = await fetch(commitUrl, {
      method: 'POST',
      headers: {
        Authorization: authKey,
        'Content-MD5': contentMd5,
        'Content-Type': 'application/xml',
        'x-oss-callback': callbackBase64,
        'x-oss-date': time,
        'x-oss-user-agent': 'aliyun-sdk-js/6.6.1 Chrome 98.0.4758.80 on Windows 10 64-bit',
        Referer: 'https://pan.quark.cn/',
      },
      body: xmlBody,
    })

    if (!response.ok) {
      throw new QuarkApiError(`Quark upload commit failed (${response.status}).`, response.status)
    }
  }

  async finishUpload(objectKey: string, taskId: string): Promise<void> {
    const url = new URL('/1/clouddrive/file/upload/finish', QUARK_API_BASE)
    for (const [key, value] of Object.entries(DEFAULT_QUERY)) {
      url.searchParams.set(key, value)
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify({
        obj_key: objectKey,
        task_id: taskId,
      }),
    })
    this.captureCookieUpdates(response)

    const payload = (await response.json().catch(() => null)) as QuarkFinishEnvelope | null
    if (!response.ok || payload?.status !== 200) {
      throw new QuarkApiError(this.getErrorMessage(payload, response.status), response.status)
    }
  }

  async uploadSmallFile(args: {
    fileName: string
    parentFid: string
    bytes: Uint8Array
    mimeType: string
  }): Promise<{ created: boolean }> {
    const ticket = await this.prepareUpload(args.fileName, args.bytes.byteLength, args.parentFid, args.mimeType)
    if (ticket.alreadyFinished) {
      return { created: true }
    }

    const md5 = await digestToHex('MD5', args.bytes)
    const sha1 = await digestToHex('SHA-1', args.bytes)
    const finishedByHash = await this.updateUploadHash(md5, sha1, ticket.taskId)
    if (finishedByHash) {
      return { created: true }
    }

    if (!ticket.uploadId) {
      throw new QuarkApiError('Quark upload preflight did not return an uploadId for multipart upload.', 502)
    }

    if (args.bytes.byteLength > ticket.partSize) {
      throw new QuarkApiError(
        `Current Worker upload MVP only supports files up to ${ticket.partSize} bytes.`,
        413,
      )
    }

    const utcTime = new Date().toUTCString()
    const authMeta = buildUploadPartAuthMeta({
      mimeType: ticket.mimeType,
      utcTime,
      bucket: ticket.bucket,
      objectKey: ticket.objectKey,
      uploadId: ticket.uploadId,
    })
    const authKey = await this.authenticateUpload(ticket.authInfo, authMeta, ticket.taskId)
    const etag = await this.uploadSinglePart({
      authKey,
      mimeType: ticket.mimeType,
      utcTime,
      bucket: ticket.bucket,
      uploadUrl: ticket.uploadUrl,
      objectKey: ticket.objectKey,
      uploadId: ticket.uploadId,
      bytes: args.bytes,
    })
    await this.commitSinglePartUpload({
      etag,
      callback: ticket.callback,
      bucket: ticket.bucket,
      objectKey: ticket.objectKey,
      uploadId: ticket.uploadId,
      authInfo: ticket.authInfo,
      taskId: ticket.taskId,
      uploadUrl: ticket.uploadUrl,
    })
    await this.finishUpload(ticket.objectKey, ticket.taskId)
    return { created: true }
  }

  private createHeaders(): HeadersInit {
    return {
      ...DEFAULT_HEADERS,
      cookie: this.cookie,
    }
  }

  private getErrorMessage(
    payload: { error?: string; message?: string; status?: number; code?: number } | null,
    status: number,
  ): string {
    const parts = [
      payload?.error ?? payload?.message ?? `Quark upstream request failed (${status}).`,
      payload?.status !== undefined ? `upstreamStatus=${payload.status}` : '',
      payload?.code !== undefined ? `upstreamCode=${payload.code}` : '',
      `httpStatus=${status}`,
    ].filter(Boolean)

    return parts.join(' | ')
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

async function digestToHex(algorithm: 'MD5' | 'SHA-1', data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, data)
  return bytesToHex(new Uint8Array(digest))
}

async function digestToBase64(algorithm: 'MD5' | 'SHA-1', data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, data)
  return uint8ArrayToBase64(new Uint8Array(digest))
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function toBase64(value: string): string {
  return uint8ArrayToBase64(new TextEncoder().encode(value))
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const value of bytes) {
    binary += String.fromCharCode(value)
  }

  return btoa(binary)
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, '')
}

function buildUploadPartAuthMeta(args: {
  mimeType: string
  utcTime: string
  bucket: string
  objectKey: string
  uploadId: string
}): string {
  return [
    'PUT',
    '',
    args.mimeType,
    args.utcTime,
    `x-oss-date:${args.utcTime}`,
    'x-oss-user-agent:aliyun-sdk-js/6.6.1 Chrome 98.0.4758.80 on Windows 10 64-bit',
    `/${args.bucket}/${args.objectKey}?partNumber=1&uploadId=${args.uploadId}`,
  ].join('\n')
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
