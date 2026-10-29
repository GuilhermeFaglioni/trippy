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

const testDatabaseName = `trippy_api_trip_encerrar_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
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

async function tripPhase(tripId: string, token = 'organizer-token'): Promise<string> {
  const response = await get(`/trips/${tripId}`, token)
  expect(response.status).toBe(200)
  return ((await response.json()) as { trip: { phase: string } }).trip.phase
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
      `trip-encerrar-${randomUUID()}@example.test`,
      `trip-encerrar-${randomUUID()}@example.test`,
      `trip-encerrar-${randomUUID()}@example.test`,
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

it('apenas o organizador encerra a viagem e a operação é idempotente', async () => {
  const tripId = await createTrip()
  await addMember(tripId, coorganizerId, 'coorganizer')
  await addMember(tripId, memberId, 'member')
  expect(await tripPhase(tripId)).toBe('planning')

  const endByCoorganizer = { type: 'trip.end', opId: randomUUID(), tripId }
  const coorganizerResponse = await post(
    '/sync/push',
    { operations: [endByCoorganizer] },
    'coorganizer-token',
  )
  expect(await coorganizerResponse.json()).toEqual({
    results: [{ opId: endByCoorganizer.opId, status: 'rejected', reason: 'forbidden' }],
  })
  expect(await tripPhase(tripId, 'coorganizer-token')).toBe('planning')

  const endByMember = { type: 'trip.end', opId: randomUUID(), tripId }
  const memberResponse = await post('/sync/push', { operations: [endByMember] }, 'member-token')
  expect(await memberResponse.json()).toEqual({
    results: [{ opId: endByMember.opId, status: 'rejected', reason: 'forbidden' }],
  })
  expect(await tripPhase(tripId, 'member-token')).toBe('planning')

  const endByOrganizer = { type: 'trip.end', opId: randomUUID(), tripId }
  const organizerResponse = await post('/sync/push', { operations: [endByOrganizer] })
  expect(await organizerResponse.json()).toEqual({
    results: [{ opId: endByOrganizer.opId, status: 'applied' }],
  })
  expect(await tripPhase(tripId)).toBe('ended')
  expect(await tripPhase(tripId, 'coorganizer-token')).toBe('ended')

  const endedAt = await pool.query<{ ended_at: Date | null }>(
    'SELECT ended_at FROM trips WHERE id = $1',
    [tripId],
  )
  expect(endedAt.rows[0]!.ended_at).toBeInstanceOf(Date)

  const secondEnd = { type: 'trip.end', opId: randomUUID(), tripId }
  const secondResponse = await post('/sync/push', { operations: [secondEnd] })
  expect(await secondResponse.json()).toEqual({
    results: [{ opId: secondEnd.opId, status: 'applied' }],
  })
  const endedAtAfterSecond = await pool.query<{ ended_at: Date | null }>(
    'SELECT ended_at FROM trips WHERE id = $1',
    [tripId],
  )
  expect(endedAtAfterSecond.rows[0]!.ended_at).toEqual(endedAt.rows[0]!.ended_at)
})
