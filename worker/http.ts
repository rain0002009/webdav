export type JsonEnvelope<T> = {
  ok: boolean
  data?: T
  message?: string
  error?: string
}

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
} satisfies HeadersInit

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json(
    {
      ok: true,
      data,
    } satisfies JsonEnvelope<T>,
    mergeInit(init),
  )
}

export function jsonMessage<T>(data: T, message: string, init?: ResponseInit): Response {
  return Response.json(
    {
      ok: true,
      data,
      message,
    } satisfies JsonEnvelope<T>,
    mergeInit(init),
  )
}

export function jsonError(message: string, status = 400, init?: ResponseInit): Response {
  return Response.json(
    {
      ok: false,
      error: message,
      message,
    } satisfies JsonEnvelope<never>,
    mergeInit({
      ...init,
      status,
    }),
  )
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new Error('Request body must be valid JSON.')
  }
}

function mergeInit(init?: ResponseInit): ResponseInit {
  return {
    ...init,
    headers: {
      ...jsonHeaders,
      ...(init?.headers ?? {}),
    },
  }
}
