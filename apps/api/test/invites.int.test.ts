import { createHash, randomUUID } from 'node:crypto'
import pg, { type Pool } from 'pg'
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

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')
const candidateSecret = 'segredo-de-candidato-integração-com-entropia-suficiente'

const testDatabaseName = `trippy_api_invites_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`

const tokenUsers = new Map<string, string>()
let databaseCreated = false
let pool: Pool
let app: ReturnType<typeof createApp>
let organizerId: string
let memberId: string
let outsiderId: string

const healthyChecks: HealthChecks = {
  postgres: async () => {},
  storage: async () => {},
  queue: async () => {},
  mail: async () => {},
}

async function get(path: string, token = 'organizer-token') {
  return app.request(path, { headers: { authorization: `Bearer ${token}` } })
}

async function post(path: string, body: unknown, token = 'organizer-token') {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

async function createTrip(): Promise<string> {
  const response = await post('/trips', {
    name: `Convite ${randomUUID()}`,
    destination: 'Tóquio',
    startDate: '2026-11-01',
    endDate: '2026-11-05',
    timezone: 'Asia/Tokyo',
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as { trip: { id: string } }).trip.id
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
  const users = await pool.query<{ id: string }>(
    'INSERT INTO users (email) VALUES ($1), ($2), ($3) RETURNING id',
    [
      `invite-organizer-${randomUUID()}@example.test`,
      `invite-member-${randomUUID()}@example.test`,
      `invite-outsider-${randomUUID()}@example.test`,
    ],
  )
  organizerId = users.rows[0]!.id
  memberId = users.rows[1]!.id
  outsiderId = users.rows[2]!.id
  tokenUsers.set('organizer-token', organizerId)
  tokenUsers.set('member-token', memberId)
  tokenUsers.set('outsider-token', outsiderId)

  const trips = createTripsRouter(
    { databaseUrl: testDatabaseUrl.toString() },
    {
      tripStore: new PostgresTripStore(pool),
      accessTokenVerifier: async (token) => {
        const verifiedUserId = tokenUsers.get(token)
        if (!verifiedUserId) throw new Error('Token inválido')
        return { userId: verifiedUserId }
      },
    },
  )
  const accessTokenVerifier = async (token: string) => {
    const verifiedUserId = tokenUsers.get(token)
    if (!verifiedUserId) throw new Error('Token inválido')
    return { userId: verifiedUserId }
  }
  const sync = createSyncRouter(
    { databaseUrl: testDatabaseUrl.toString(), placesCandidateSecret: candidateSecret },
    { syncStore: new PostgresSyncStore(pool, candidateSecret), accessTokenVerifier },
  )
  const invites = createInvitesRouter(
    { databaseUrl: testDatabaseUrl.toString() },
    {
      inviteStore: new PostgresInviteStore(pool),
      accessTokenVerifier: async (token) => {
        const verifiedUserId = tokenUsers.get(token)
        if (!verifiedUserId) throw new Error('Token inválido')
        return { userId: verifiedUserId }
      },
    },
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

it('gera convite com hash, aceita, sincroniza membro, reentra e é idempotente', async () => {
  const tripId = await createTrip()
  const created = await post(`/trips/${tripId}/invites`, {})
  expect(created.status).toBe(201)
  const { token } = (await created.json()) as { token: string }
  expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/u)

  const savedInvite = await pool.query<{ token_hash: string }>(
    'SELECT token_hash FROM invites WHERE trip_id = $1',
    [tripId],
  )
  expect(savedInvite.rows).toEqual([
    { token_hash: createHash('sha256').update(token).digest('hex') },
  ])
  expect(savedInvite.rows[0]!.token_hash).not.toBe(token)

  const accepted = await post('/invites/accept', { token }, 'member-token')
  expect(accepted.status).toBe(200)
  expect(await accepted.json()).toMatchObject({ trip: { id: tripId, role: 'member' } })
  const memberTripsResponse = await get('/trips', 'member-token')
  expect(await memberTripsResponse.json()).toMatchObject({
    trips: [expect.objectContaining({ id: tripId })],
  })

  const firstPull = await get(`/sync/pull?trip=${tripId}&cursor=0&limit=10`, 'member-token')
  expect(await firstPull.json()).toMatchObject({
    members: [
      expect.objectContaining({ userId: organizerId }),
      expect.objectContaining({ userId: memberId }),
    ],
  })

  const counterBeforeDuplicate = await pool.query<{ seq_counter: string }>(
    'SELECT seq_counter FROM trips WHERE id = $1',
    [tripId],
  )
  const duplicateAccept = await post('/invites/accept', { token }, 'member-token')
  expect(duplicateAccept.status).toBe(200)
  const counterAfterDuplicate = await pool.query<{ seq_counter: string }>(
    'SELECT seq_counter FROM trips WHERE id = $1',
    [tripId],
  )
  expect(counterAfterDuplicate.rows[0]!.seq_counter).toBe(
    counterBeforeDuplicate.rows[0]!.seq_counter,
  )

  const departure = await pool.query<{ seq_counter: string }>(
    'UPDATE trips SET seq_counter = seq_counter + 1 WHERE id = $1 RETURNING seq_counter',
    [tripId],
  )
  await pool.query(
    'UPDATE trip_members SET left_at = now(), seq = $3 WHERE trip_id = $1 AND user_id = $2',
    [tripId, memberId, departure.rows[0]!.seq_counter],
  )
  const reentered = await post('/invites/accept', { token }, 'member-token')
  expect(reentered.status).toBe(200)
  const activeMembership = await pool.query<{ left_at: Date | null; role: string }>(
    'SELECT left_at, role FROM trip_members WHERE trip_id = $1 AND user_id = $2',
    [tripId, memberId],
  )
  expect(activeMembership.rows[0]).toMatchObject({ left_at: null, role: 'member' })

  const memberCannotInvite = await post(`/trips/${tripId}/invites`, {}, 'member-token')
  expect(memberCannotInvite.status).toBe(403)
})

it('esconde convite inexistente ou revogado com o mesmo erro genérico', async () => {
  const tripId = await createTrip()
  const created = await post(`/trips/${tripId}/invites`, {})
  const { token } = (await created.json()) as { token: string }
  await pool.query('UPDATE invites SET revoked_at = now() WHERE trip_id = $1', [tripId])

  const revoked = await post('/invites/accept', { token }, 'outsider-token')
  const missing = await post('/invites/accept', { token: randomUUID() }, 'outsider-token')
  expect(revoked.status).toBe(404)
  expect(await revoked.json()).toEqual({
    error: 'invite_not_found',
    message: 'Convite não encontrado.',
  })
  expect(await missing.json()).toEqual({
    error: 'invite_not_found',
    message: 'Convite não encontrado.',
  })

  const outsiderInvite = await post(`/trips/${tripId}/invites`, {}, 'outsider-token')
  expect(outsiderInvite.status).toBe(404)
  expect(await outsiderInvite.json()).toMatchObject({
    error: 'trip_not_found',
    message: expect.any(String),
  })
})
