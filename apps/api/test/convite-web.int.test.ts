import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PostgresInviteStore } from '@trippy/adapters/invites'
import { PostgresSyncStore } from '@trippy/adapters/sync'
import { PostgresTripStore } from '@trippy/adapters/trips'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { createApp } from '../src/app.ts'
import { createInvitesRouter } from '../src/invites/router.ts'
import { createSyncRouter } from '../src/sync/router.ts'
import { createTripsRouter } from '../src/trips/router.ts'
import type { HealthChecks } from '../src/health.ts'

type Pool = InstanceType<typeof pg.Pool>

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')
const candidateSecret = 'segredo-de-candidato-integração-com-entropia-suficiente'

const testDatabaseName = `trippy_api_convite_web_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`

const tokenUsers = new Map<string, string>()
let databaseCreated = false
let pool: Pool
let app: ReturnType<typeof createApp>
let organizerId: string
let organizerEmail: string

const healthyChecks: HealthChecks = {
  postgres: async () => {},
  storage: async () => {},
  queue: async () => {},
  mail: async () => {},
}

async function post(path: string, body: unknown, token = 'organizer-token') {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

async function createTrip(name = `Convite ${randomUUID()}`): Promise<string> {
  const response = await post('/trips', {
    name,
    destination: 'Tóquio',
    startDate: '2026-11-01',
    endDate: '2026-11-05',
    timezone: 'Asia/Tokyo',
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as { trip: { id: string } }).trip.id
}

async function createInviteToken(tripId: string): Promise<string> {
  const created = await post(`/trips/${tripId}/invites`, {})
  expect(created.status).toBe(201)
  return ((await created.json()) as { token: string }).token
}

async function insertPlace(
  tripId: string,
  fields: {
    name: string
    dayIndex: number | null
    position: number | null
    seq: number
    deletedAt?: boolean
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO places (id, trip_id, name, suggested_by, day_index, position, seq, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8 THEN now() ELSE NULL END)`,
    [
      randomUUID(),
      tripId,
      fields.name,
      organizerId,
      fields.dayIndex,
      fields.position,
      fields.seq,
      fields.deletedAt ?? false,
    ],
  )
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
  pool = new pg.Pool({ connectionString: testDatabaseUrl.toString() })
  organizerEmail = `convite-web-organizer-${randomUUID()}@example.test`
  const users = await pool.query<{ id: string }>(
    'INSERT INTO users (email) VALUES ($1), ($2) RETURNING id',
    [organizerEmail, `convite-web-outsider-${randomUUID()}@example.test`],
  )
  organizerId = users.rows[0]!.id
  tokenUsers.set('organizer-token', organizerId)
  tokenUsers.set('outsider-token', users.rows[1]!.id)

  const accessTokenVerifier = async (token: string) => {
    const verifiedUserId = tokenUsers.get(token)
    if (!verifiedUserId) throw new Error('Token inválido')
    return { userId: verifiedUserId }
  }
  const trips = createTripsRouter(
    { databaseUrl: testDatabaseUrl.toString() },
    { tripStore: new PostgresTripStore(pool), accessTokenVerifier },
  )
  const sync = createSyncRouter(
    { databaseUrl: testDatabaseUrl.toString(), placesCandidateSecret: candidateSecret },
    { syncStore: new PostgresSyncStore(pool, candidateSecret), accessTokenVerifier },
  )
  const invites = createInvitesRouter(
    { databaseUrl: testDatabaseUrl.toString() },
    { inviteStore: new PostgresInviteStore(pool), accessTokenVerifier },
  )
  app = createApp(healthyChecks, 1_000, undefined, trips.router, sync.router, invites.router)
})

afterAll(async () => {
  if (pool) await pool.end()
  if (databaseCreated) {
    const admin = new pg.Client({ connectionString: adminUrl.toString() })
    await admin.connect()
    try {
      await admin.query(`DROP DATABASE "${testDatabaseName}"`)
    } finally {
      await admin.end()
    }
  }
})

it('mostra convite válido sem roteiro com cabeçalhos de segurança e sem vazar e-mail', async () => {
  const tripName = `Viagem Japão ${randomUUID().slice(0, 8)}`
  const tripId = await createTrip(tripName)
  const token = await createInviteToken(tripId)

  const response = await app.request(`/i/${token}`)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
  expect(response.headers.get('content-security-policy')).toBe(
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  )
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-frame-options')).toBe('DENY')

  const html = await response.text()
  expect(html).toContain('<html lang="pt-BR">')
  expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1"')
  expect(html).toContain(`<title>Convite para ${tripName} — Trippy</title>`)
  expect(html).toContain(`property="og:title" content="Convite para ${tripName} — Trippy"`)
  expect(html).toContain('property="og:type" content="website"')
  expect(html).toContain(tripName)
  expect(html).toContain('01/11/2026 a 05/11/2026')
  expect(html).toContain('1 pessoa')
  expect(html).toContain('O roteiro ainda não foi montado.')
  expect(html).toContain(`href="trippy://convite/${token}"`)
  expect(html).toContain('Se nada acontecer, instale o app Trippy e abra este link novamente.')
  expect(html).not.toContain(organizerEmail)
  expect(html).not.toContain(organizerId)
})

it('agrupa lugares por dia, escapa HTML e ignora lugares sem dia ou apagados', async () => {
  const tripId = await createTrip('<script>alert("x")</script>Roma')
  await insertPlace(tripId, { name: 'Coliseu', dayIndex: 0, position: 1, seq: 900 })
  await insertPlace(tripId, { name: 'Panteão', dayIndex: 0, position: 0, seq: 901 })
  await insertPlace(tripId, {
    name: '<script>alert(1)</script>Trastevere',
    dayIndex: 2,
    position: 0,
    seq: 902,
  })
  await insertPlace(tripId, { name: 'Sem dia', dayIndex: null, position: null, seq: 903 })
  await insertPlace(tripId, {
    name: 'Apagado',
    dayIndex: 1,
    position: 0,
    seq: 904,
    deletedAt: true,
  })
  const token = await createInviteToken(tripId)

  const response = await app.request(`/i/${token}`)
  expect(response.status).toBe(200)
  const html = await response.text()

  expect(html).not.toContain('<script>')
  expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;Roma')
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;Trastevere')
  expect(html).not.toContain('O roteiro ainda não foi montado.')
  expect(html).not.toContain('Sem dia')
  expect(html).not.toContain('Apagado')

  const dia1 = html.indexOf('Dia 1 — 01/11/2026')
  const dia3 = html.indexOf('Dia 3 — 03/11/2026')
  expect(dia1).toBeGreaterThan(-1)
  expect(dia3).toBeGreaterThan(dia1)
  expect(html.indexOf('Panteão')).toBeLessThan(html.indexOf('Coliseu'))
  expect(html.indexOf('Coliseu')).toBeLessThan(dia3)
  expect(html.indexOf('Trastevere')).toBeGreaterThan(dia3)
  expect(html).not.toContain('Dia 2 —')
})

it('responde 404 idêntico para código inexistente e convite revogado', async () => {
  const tripId = await createTrip()
  const token = await createInviteToken(tripId)
  await pool.query('UPDATE invites SET revoked_at = now() WHERE trip_id = $1', [tripId])

  const revoked = await app.request(`/i/${token}`)
  const missing = await app.request(`/i/${randomUUID()}`)

  expect(revoked.status).toBe(404)
  expect(missing.status).toBe(404)
  expect(revoked.headers.get('content-type')).toBe('text/html; charset=utf-8')
  expect(revoked.headers.get('content-security-policy')).toContain("default-src 'none'")
  expect(revoked.headers.get('cache-control')).toBe('no-store')

  const revokedHtml = await revoked.text()
  const missingHtml = await missing.text()
  expect(revokedHtml).toContain(
    'Este convite não está disponível. Peça um novo link a quem convidou.',
  )
  expect(revokedHtml).toBe(missingHtml)
  expect(revokedHtml).not.toContain(tripId)
})

it('hash do código exibido bate com o token_hash salvo', async () => {
  const tripId = await createTrip()
  const token = await createInviteToken(tripId)
  const saved = await pool.query<{ token_hash: string }>(
    'SELECT token_hash FROM invites WHERE trip_id = $1',
    [tripId],
  )
  expect(saved.rows[0]!.token_hash).toBe(createHash('sha256').update(token).digest('hex'))
})
