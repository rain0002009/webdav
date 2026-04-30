import { handleSessionApiRequest } from './api/session'
import { jsonError } from './http'
import { handleWebDavRequest } from './webdav'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/session/')) {
      return handleSessionApiRequest(request, env)
    }

    if (url.pathname === '/dav' || url.pathname.startsWith('/dav/')) {
      return handleWebDavRequest(request, env)
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonError('Unknown API route.', 404)
    }

    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<Env>
