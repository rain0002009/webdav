export type QuarkEntry = {
  fid: string
  parentFid: string
  name: string
  isDirectory: boolean
  size: number
  updatedAt?: string
  contentType?: string
}

export type QuarkResolvedPath = {
  path: string
  entry: QuarkEntry
}

export type QuarkDirectoryListing = {
  parentFid: string
  entries: QuarkEntry[]
}

export type QuarkDownloadLink = {
  url: string
  expiresAt?: number
}

export type QuarkUploadTicket = {
  taskId: string
  uploadId: string
  uploadUrl: string
  bucket: string
  objectKey: string
  authInfo: string
  callback: {
    callbackUrl: string
    callbackBody: string
  }
  partSize: number
  mimeType: string
  fileId: string
  alreadyFinished: boolean
}

export class QuarkApiError extends Error {
  readonly status: number
  readonly code?: number

  constructor(message: string, status: number, code?: number) {
    super(message)
    this.name = 'QuarkApiError'
    this.status = status
    this.code = code
  }
}
