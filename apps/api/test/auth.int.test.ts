import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { createApp } from '../src/app.ts'
import { createAuthRouter } from '../src/auth/router.ts'
import { loadConfig } from '../src/config.ts'
import type { HealthChecks } from '../src/health.ts'

const baseDatabaseUrl = process.env.DATABASE_URL
if (!baseDatabaseUrl) {
  throw new Error('DATABASE_URL não definido: configure o Postgres local')
}

const testDatabaseName = `trippy_auth_test_${process.pid}_${randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(baseDatabaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(baseDatabaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`

const testNow = { value: new Date() }
let databaseCreated = false
let app!: ReturnType<typeof createApp>
let closeAuth: () => Promise<void> = async () => {}

const healthyChecks: HealthChecks = {
  postgres: async () => {},
  storage: async () => {},
  queue: async () => {},
  mail: async () => {},
}

async function post(path: string, body: unknown, headers: HeadersInit = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function readLatestCode(email: string): Promise<string> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const search = await fetch(
      `http://localhost:58025/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    )
    if (search.ok) {
      const result = (await search.json()) as { messages?: Array<{ ID: string }> }
      const latest = result.messages?.[0]
      if (latest) {
        const message = await fetch(`http://localhost:58025/api/v1/message/${latest.ID}`)
        if (message.ok) {
          const details = (await message.json()) as { Text?: string }
          const code = details.Text?.match(/\b\d{6}\b/u)?.[0]
          if (code) return code
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Mailpit não recebeu o código de ${email} em 10 segundos.`)
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${testDatabaseName}"`)
    databaseCreated = true
  } finally {
    await admin.end()
  }

  await migrate({ databaseUrl: testDatabaseUrl.toString() })
  const config = loadConfig({ ...process.env, DATABASE_URL: testDatabaseUrl.toString() })
  const auth = await createAuthRouter(config, { now: () => testNow.value })
  closeAuth = auth.close
  app = createApp(healthyChecks, 1_000, auth.router)
})

afterAll(async () => {
  if (closeAuth) await closeAuth()
  if (!databaseCreated) return

  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE "${testDatabaseName}"`)
  } finally {
    await admin.end()
  }
})

it('completa login pelo Mailpit, /me, refresh rotativo e revogação por reuso', async () => {
  const email = `login-${randomUUID()}@example.test`
  const start = await post('/auth/email/start', { email })
  expect(start.status).toBe(202)
  expect(await start.json()).toEqual({})

  const code = await readLatestCode(email)
  const verification = await post('/auth/email/verify', { email, code })
  expect(verification.status).toBe(200)
  const session = (await verification.json()) as {
    accessToken: string
    accessTokenExpiresAt: string
    refreshToken: string
    user: { id: string; email: string; name: string | null }
  }
  expect(session.user).toMatchObject({ email, name: null })
  expect(session.accessTokenExpiresAt).toMatch(/^\d{4}-\d\d-\d\dT/u)
  expect(Date.parse(session.accessTokenExpiresAt) - Date.now()).toBeGreaterThan(14 * 60 * 1000)

  const me = await app.request('/me', {
    headers: { authorization: `Bearer ${session.accessToken}` },
  })
  expect(me.status).toBe(200)
  expect(await me.json()).toEqual({ user: session.user })

  const refresh = await post('/auth/refresh', { refreshToken: session.refreshToken })
  expect(refresh.status).toBe(200)
  const rotated = (await refresh.json()) as typeof session
  expect(rotated.refreshToken).not.toBe(session.refreshToken)
  expect(rotated.user).toEqual(session.user)

  const reused = await post('/auth/refresh', { refreshToken: session.refreshToken })
  expect(reused.status).toBe(401)
  expect(await reused.json()).toMatchObject({ error: 'invalid_refresh_token' })

  const revokedDescendant = await post('/auth/refresh', { refreshToken: rotated.refreshToken })
  expect(revokedDescendant.status).toBe(401)
  expect(await revokedDescendant.json()).toMatchObject({ error: 'invalid_refresh_token' })

  const logout = await post('/auth/logout', { refreshToken: rotated.refreshToken })
  expect(logout.status).toBe(204)
}, 30_000)

it('retorna erros JSON para e-mail inválido e /me sem bearer', async () => {
  const invalidEmail = await post('/auth/email/start', { email: 'inválido' })
  expect(invalidEmail.status).toBe(400)
  expect(await invalidEmail.json()).toMatchObject({ error: 'invalid_email' })

  const me = await app.request('/me')
  expect(me.status).toBe(401)
  expect(await me.json()).toMatchObject({ error: 'unauthorized' })
})

it('limita reenvio a 60 segundos e invalida o código após cinco tentativas', async () => {
  const email = `attempts-${randomUUID()}@example.test`
  expect((await post('/auth/email/start', { email })).status).toBe(202)
  const throttled = await post('/auth/email/start', { email })
  expect(throttled.status).toBe(429)
  expect(await throttled.json()).toMatchObject({ error: 'too_many_requests' })

  const code = await readLatestCode(email)
  for (let attempt = 1; attempt < 5; attempt += 1) {
    const wrongCode = await post('/auth/email/verify', {
      email,
      code: '000000' === code ? '000001' : '000000',
    })
    expect(wrongCode.status).toBe(401)
    expect(await wrongCode.json()).toMatchObject({ error: 'invalid_code' })
  }
  const fifthAttempt = await post('/auth/email/verify', {
    email,
    code: '000000' === code ? '000001' : '000000',
  })
  expect(fifthAttempt.status).toBe(429)
  expect(await fifthAttempt.json()).toMatchObject({ error: 'too_many_attempts' })

  const correctAfterInvalidation = await post('/auth/email/verify', { email, code })
  expect(correctAfterInvalidation.status).toBe(429)
  expect(await correctAfterInvalidation.json()).toMatchObject({ error: 'too_many_attempts' })
}, 30_000)

it('envio após 60 segundos invalida o código anterior', async () => {
  const email = `resend-${randomUUID()}@example.test`
  expect((await post('/auth/email/start', { email })).status).toBe(202)
  const firstCode = await readLatestCode(email)
  testNow.value = new Date(testNow.value.getTime() + 60 * 1000)

  expect((await post('/auth/email/start', { email })).status).toBe(202)
  const latestCode = await readLatestCode(email)
  expect(latestCode).not.toBe(firstCode)
  const previousCode = await post('/auth/email/verify', { email, code: firstCode })
  expect(previousCode.status).toBe(401)
  expect(await previousCode.json()).toMatchObject({ error: 'invalid_code' })

  const currentCode = await post('/auth/email/verify', { email, code: latestCode })
  expect(currentCode.status).toBe(200)
}, 30_000)

it('recusa código vencido após dez minutos', async () => {
  const email = `expired-${randomUUID()}@example.test`
  expect((await post('/auth/email/start', { email })).status).toBe(202)
  const code = await readLatestCode(email)
  testNow.value = new Date(testNow.value.getTime() + 10 * 60 * 1000)

  const verification = await post('/auth/email/verify', { email, code })
  expect(verification.status).toBe(401)
  expect(await verification.json()).toMatchObject({ error: 'invalid_code' })
}, 30_000)
