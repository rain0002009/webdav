// Run with Node.js 24+: node scripts/check-logout.mjs
// Exercises the real Worker routes with synthetic data and an in-memory KV.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const { default: worker } = await import('../worker/index.ts')
const store = await import('../worker/session-store.ts')
const records = new Map()
const env = {
  DAV_CREDENTIALS: {
    async get(key, type) {
      const value = records.get(key)
      return value === undefined ? null : type === 'json' ? JSON.parse(value) : value
    },
    async put(key, value) { records.set(key, value) },
    async delete(key) { records.delete(key) },
  },
}

const account = await store.createAccount({ identityKey: 'logout-regression-fixture' }, env)
await store.setAccountStatus(account.accountKey, 'approved', env)
const credentials = await store.ensureCredentialsForAccount(account.accountKey, env)
await store.saveQuarkSessionForAccount(account.accountKey, 'sid=logout-regression-fixture', {}, env)
const authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`
const request = (path, method, authenticated = true) => worker.fetch(new Request(
  `https://logout-check.invalid${path}`,
  { method, headers: authenticated ? { authorization } : {} },
), env)

assert.equal((await request('/dav', 'OPTIONS')).status, 204)
const beforeLogout = new Map(records)
const logout = await request('/api/session/logout', 'POST')
assert.equal(logout.status, 200)
assert.equal(logout.headers.has('www-authenticate'), false)
assert.equal((await logout.json()).data.cleared, true)
const afterLogout = await request('/dav', 'OPTIONS')
assert.equal(afterLogout.status, 204, 'WebDAV must remain available after console logout')
assert.deepEqual(records, beforeLogout, 'Console logout must preserve all account and Quark session records')

const anonymousStatus = await request('/api/session/status', 'GET', false)
const status = (await anonymousStatus.json()).data
assert.equal(status.loggedIn, false)
assert.equal(status.webdavCredentials, undefined)

const unauthorizedLogout = await request('/api/session/logout', 'POST', false)
assert.equal(unauthorizedLogout.status, 401)
assert.equal(unauthorizedLogout.headers.has('www-authenticate'), false)
assert.deepEqual(records, beforeLogout)
console.log('PASS: console logout preserves Quark session and WebDAV access; anonymous console stays logged out.')
