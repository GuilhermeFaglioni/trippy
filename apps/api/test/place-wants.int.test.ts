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

const testDatabaseName = `trippy_api_place_wants_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
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

async function addPlace(tripId: string): Promise<string> {
  const placeId = randomUUID()
  const response = await post('/sync/push', {
    operations: [{ type: 'place.add', opId: randomUUID(), tripId, placeId, name: 'Jardim' }],
  })
  expect(await response.json()).toEqual({
    results: [expect.objectContaining({ status: 'applied' })],
  })
  return placeId
}

function wantOperation(type: 'place.want' | 'place.unwant', tripId: string, placeId: string) {
  return { type, opId: randomUUID(), tripId, placeId }
}

async function pushStatus(operation: unknown, token = 'organizer-token'): Promise<string> {
  const response = await post('/sync/push', { operations: [operation] }, token)
  const body = (await response.json()) as { results: Array<{ status: string; reason?: string }> }
  const result = body.results[0]!
  return result.status === 'rejected' ? `rejected:${result.reason}` : result.status
}

async function bootstrapWants(tripId: string, token = 'organizer-token') {
  const response = await get(`/sync/pull?trip=${tripId}&limit=100`, token)
  return ((await response.json()) as { wants: Array<{ userId: string; deletedAt: string | null }> })
    .wants
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
      `place-wants-${randomUUID()}@example.test`,
      `place-wants-${randomUUID()}@example.test`,
      `place-wants-${randomUUID()}@example.test`,
    ],
  )
  organizerId = users.rows[0]!.id
  coorganizerId = users.rows[1]!.id
  memberId = users.rows[2]!.id
  tokenUsers.set('organizer-token', organizerId)
  tokenUsers.set('coorganizer-token', coorganizerId)
  tokenUsers.set('member-token', memberId)

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

it('quero ir é aplicado uma vez, repetido vira duplicate e unwant some do pull vivo', async () => {
  const tripId = await createTrip()
  await addMember(tripId, coorganizerId, 'coorganizer')
  const placeId = await addPlace(tripId)

  expect(await pushStatus(wantOperation('place.want', tripId, placeId))).toBe('applied')
  expect(await bootstrapWants(tripId)).toEqual([
    expect.objectContaining({ userId: organizerId, deletedAt: null }),
  ])
  expect(await pushStatus(wantOperation('place.want', tripId, placeId))).toBe('duplicate')

  expect(await pushStatus(wantOperation('place.unwant', tripId, placeId))).toBe('applied')
  expect(await pushStatus(wantOperation('place.unwant', tripId, placeId))).toBe('duplicate')
  expect(await bootstrapWants(tripId)).toEqual([])

  const row = await pool.query<{ deleted_at: Date | null }>(
    'SELECT deleted_at FROM place_wants WHERE place_id = $1 AND user_id = $2',
    [placeId, organizerId],
  )
  expect(row.rows[0]!.deleted_at).toBeInstanceOf(Date)
})

it('dois usuários convergem na contagem e lugar removido apaga as reações vivas', async () => {
  const tripId = await createTrip()
  await addMember(tripId, coorganizerId, 'coorganizer')
  await addMember(tripId, memberId, 'member')
  const placeId = await addPlace(tripId)

  expect(await pushStatus(wantOperation('place.want', tripId, placeId))).toBe('applied')
  expect(await pushStatus(wantOperation('place.want', tripId, placeId), 'coorganizer-token')).toBe(
    'applied',
  )
  const fromOrganizer = await bootstrapWants(tripId)
  const fromMember = await bootstrapWants(tripId, 'member-token')
  expect(fromOrganizer.map(({ userId }) => userId).sort()).toEqual(
    [organizerId, coorganizerId].sort(),
  )
  expect(fromMember).toEqual(fromOrganizer)

  const removed = {
    type: 'place.remove',
    opId: randomUUID(),
    tripId,
    placeId,
  }
  expect(await pushStatus(removed)).toBe('applied')
  expect(await bootstrapWants(tripId)).toEqual([])
  expect(await pushStatus(wantOperation('place.want', tripId, placeId), 'member-token')).toBe(
    'rejected:invalid',
  )
})

it('membro removido não pode mais querer ir', async () => {
  const tripId = await createTrip()
  await addMember(tripId, memberId, 'member')
  const placeId = await addPlace(tripId)

  expect(await pushStatus(wantOperation('place.want', tripId, placeId), 'member-token')).toBe(
    'applied',
  )
  const removeMember = { type: 'member.remove', opId: randomUUID(), tripId, userId: memberId }
  expect(await pushStatus(removeMember)).toBe('applied')
  expect(await pushStatus(wantOperation('place.unwant', tripId, placeId), 'member-token')).toBe(
    'rejected:not_member',
  )
  expect(await pushStatus(wantOperation('place.want', tripId, placeId), 'member-token')).toBe(
    'rejected:not_member',
  )
})
