import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PostgresTripStore } from '@trippy/adapters/trips'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { createApp } from '../src/app.ts'
import { createSyncRouter } from '../src/sync/router.ts'
import { createTripsRouter } from '../src/trips/router.ts'
import type { HealthChecks } from '../src/health.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')

const testDatabaseName = `trippy_api_trip_abriu_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`

const tokenUsers = new Map<string, string>()
let databaseCreated = false
const candidateSecret = 'segredo-de-candidato-integração-com-entropia-suficiente'
type Pool = InstanceType<typeof pg.Pool>
let pool: Pool
let app: ReturnType<typeof createApp>
let organizerId: string
let coorganizerId: string
let memberId: string
let outsiderId: string
let closeSync: () => Promise<void> = async () => {}

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
    name: `Viagem ${randomUUID()}`,
    destination: 'Lisboa',
    startDate: '2026-11-01',
    endDate: '2026-11-05',
    timezone: 'Europe/Lisbon',
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as { trip: { id: string } }).trip.id
}

async function addMember(tripId: string, userId: string, role: 'coorganizer' | 'member') {
  const sequence = await pool.query<{ seq_counter: string }>(
    'UPDATE trips SET seq_counter = seq_counter + 1 WHERE id = $1 RETURNING seq_counter',
    [tripId],
  )
  await pool.query(
    `INSERT INTO trip_members (trip_id, user_id, role, seq)
     VALUES ($1, $2, $3, $4)`,
    [tripId, userId, role, sequence.rows[0]!.seq_counter],
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
  const users = await pool.query<{ id: string }>(
    'INSERT INTO users (email) VALUES ($1), ($2), ($3), ($4) RETURNING id',
    [
      `trip-abriu-${randomUUID()}@example.test`,
      `trip-abriu-${randomUUID()}@example.test`,
      `trip-abriu-${randomUUID()}@example.test`,
      `trip-abriu-${randomUUID()}@example.test`,
    ],
  )
  organizerId = users.rows[0]!.id
  coorganizerId = users.rows[1]!.id
  memberId = users.rows[2]!.id
  outsiderId = users.rows[3]!.id
  tokenUsers.set('organizer-token', organizerId)
  tokenUsers.set('coorganizer-token', coorganizerId)
  tokenUsers.set('member-token', memberId)
  tokenUsers.set('outsider-token', outsiderId)

  const accessTokenVerifier = async (token: string) => {
    const userId = tokenUsers.get(token)
    if (!userId) throw new Error('Token inválido')
    return { userId }
  }
  const trips = createTripsRouter(
    { databaseUrl: testDatabaseUrl.toString() },
    { tripStore: new PostgresTripStore(pool), accessTokenVerifier },
  )
  const sync = createSyncRouter(
    { databaseUrl: testDatabaseUrl.toString(), placesCandidateSecret: candidateSecret },
    { accessTokenVerifier },
  )
  closeSync = sync.close
  app = createApp(healthyChecks, 1_000, undefined, trips.router, sync.router)
})

afterAll(async () => {
  await closeSync()
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

async function memberOpening(tripId: string, userId: string) {
  const result = await pool.query<{ first_opened_at: Date | null; seq: string }>(
    'SELECT first_opened_at, seq::text AS seq FROM trip_members WHERE trip_id = $1 AND user_id = $2',
    [tripId, userId],
  )
  return result.rows[0]!
}

it('o primeiro trip.open registra a abertura do membro, aparece no pull e não avança seq na segunda vez', async () => {
  const tripId = await createTrip()
  await addMember(tripId, coorganizerId, 'coorganizer')
  await addMember(tripId, memberId, 'member')
  expect((await memberOpening(tripId, memberId)).first_opened_at).toBeNull()

  const firstOpen = { type: 'trip.open', opId: randomUUID(), tripId }
  const firstResponse = await post('/sync/push', { operations: [firstOpen] }, 'member-token')
  expect(await firstResponse.json()).toEqual({
    results: [{ opId: firstOpen.opId, status: 'applied' }],
  })

  const afterFirst = await memberOpening(tripId, memberId)
  expect(afterFirst.first_opened_at).toBeInstanceOf(Date)
  expect(BigInt(afterFirst.seq)).toBeGreaterThan(0n)

  const pull = await get(`/sync/pull?trip=${tripId}&cursor=0&limit=100`, 'coorganizer-token')
  expect(pull.status).toBe(200)
  const pulled = (await pull.json()) as {
    members: Array<{ userId: string; openedAt: string | null; seq: string }>
  }
  const openedMember = pulled.members.find((member) => member.userId === memberId)
  expect(openedMember).toMatchObject({
    openedAt: afterFirst.first_opened_at!.toISOString(),
    seq: afterFirst.seq,
  })
  expect(pulled.members.find((member) => member.userId === coorganizerId)?.openedAt).toBeNull()

  const secondOpen = { type: 'trip.open', opId: randomUUID(), tripId }
  const secondResponse = await post('/sync/push', { operations: [secondOpen] }, 'member-token')
  expect(await secondResponse.json()).toEqual({
    results: [{ opId: secondOpen.opId, status: 'applied' }],
  })

  const afterSecond = await memberOpening(tripId, memberId)
  expect(afterSecond.first_opened_at).toEqual(afterFirst.first_opened_at)
  expect(afterSecond.seq).toBe(afterFirst.seq)
})

it('não-membro não abre a viagem e a operação é rejeitada', async () => {
  const tripId = await createTrip()
  await addMember(tripId, memberId, 'member')

  const openByOutsider = { type: 'trip.open', opId: randomUUID(), tripId }
  const response = await post('/sync/push', { operations: [openByOutsider] }, 'outsider-token')
  expect(await response.json()).toEqual({
    results: [{ opId: openByOutsider.opId, status: 'rejected', reason: 'not_member' }],
  })

  const outsiderRows = await pool.query(
    'SELECT 1 FROM trip_members WHERE trip_id = $1 AND user_id = $2',
    [tripId, outsiderId],
  )
  expect(outsiderRows.rowCount).toBe(0)
  expect((await memberOpening(tripId, memberId)).first_opened_at).toBeNull()
})
