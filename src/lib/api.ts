type ApiEnvelope<T> = {
  ok?: boolean
  success?: boolean
  message?: string
  error?: string
  data?: T
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
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
    throw new ApiError(message, response.status)
  }

  if (hasData) {
    return (envelope as ApiEnvelope<T>).data as T
  }

  return payload as T
}
