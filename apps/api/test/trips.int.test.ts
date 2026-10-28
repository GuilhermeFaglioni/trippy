import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PostgresTripStore } from '@trippy/adapters/trips'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { createApp } from '../src/app.ts'
import { createTripsRouter } from '../src/trips/router.ts'
import type { HealthChecks } from '../src/health.ts'

type Pool = InstanceType<typeof pg.Pool>

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')

const testDatabaseName = `trippy_api_trips_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`

const testNow = { value: new Date('2026-01-01T10:00:00.000Z') }
const tokenUsers = new Map<string, string>()
let databaseCreated = false
let pool: Pool
let app: ReturnType<typeof createApp>
let userId: string
let otherUserId: string

const healthyChecks: HealthChecks = {
  postgres: async () => {},
  storage: async () => {},
  queue: async () => {},
  mail: async () => {},
}

async function get(path: string, token?: string) {
  return app.request(path, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

async function post(path: string, body: unknown, token?: string) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
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
    'INSERT INTO users (email) VALUES ($1), ($2) RETURNING id',
    [`trip-api-${randomUUID()}@example.test`, `trip-api-${randomUUID()}@example.test`],
  )
  userId = users.rows[0]!.id
  otherUserId = users.rows[1]!.id
  tokenUsers.set('user-token', userId)
  tokenUsers.set('other-token', otherUserId)

  const trips = createTripsRouter(
    { databaseUrl: testDatabaseUrl.toString() },
    {
      tripStore: new PostgresTripStore(pool),
      accessTokenVerifier: async (token) => {
        const verifiedUserId = tokenUsers.get(token)
        if (!verifiedUserId) throw new Error('Token inválido')
        return { userId: verifiedUserId }
      },
      now: () => testNow.value,
    },
  )
  app = createApp(healthyChecks, 1_000, undefined, trips.router)
})

afterAll(async () => {
  if (pool) await pool.end()
  if (!databaseCreated) return

  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE "${testDatabaseName}"`)
  } finally {
    await admin.end()
  }
})

it('cria viagem, lista só membros e calcula fase no fuso da viagem', async () => {
  const response = await post(
    '/trips',
    {
      name: 'Ano novo',
      destination: 'Kiritimati',
      startDate: '2026-01-02',
      endDate: '2026-01-02',
      timezone: 'Pacific/Kiritimati',
    },
    'user-token',
  )
  expect(response.status).toBe(201)
  const created = (await response.json()) as {
    trip: {
      id: string
      name: string
      destination: string
      startDate: string
      endDate: string
      timezone: string
      role: string
      phase: string
      createdAt: string
    }
  }
  expect(created.trip).toMatchObject({
    name: 'Ano novo',
    destination: 'Kiritimati',
    startDate: '2026-01-02',
    endDate: '2026-01-02',
    timezone: 'Pacific/Kiritimati',
    role: 'organizer',
    phase: 'traveling',
  })

  const persisted = await pool.query<{ role: string; user_id: string }>(
    'SELECT role, user_id FROM trip_members WHERE trip_id = $1',
    [created.trip.id],
  )
  expect(persisted.rows).toEqual([{ role: 'organizer', user_id: userId }])

  testNow.value = new Date('2026-01-01T09:59:00.000Z')
  const ownTripsBeforeLocalMidnight = await get('/trips', 'user-token')
  expect(await ownTripsBeforeLocalMidnight.json()).toMatchObject({
    trips: [{ id: created.trip.id, phase: 'planning' }],
  })

  testNow.value = new Date('2026-01-01T10:00:00.000Z')
  const ownTrips = await get('/trips', 'user-token')
  expect(ownTrips.status).toBe(200)
  expect(await ownTrips.json()).toMatchObject({
    trips: [{ id: created.trip.id, phase: 'traveling' }],
  })

  const memberTrip = await get(`/trips/${created.trip.id}`, 'user-token')
  expect(memberTrip.status).toBe(200)
  expect(await memberTrip.json()).toMatchObject({
    trip: { id: created.trip.id, role: 'organizer', phase: 'traveling' },
  })

  const otherTrips = await get('/trips', 'other-token')
  expect(await otherTrips.json()).toEqual({ trips: [] })

  const hiddenTrip = await get(`/trips/${created.trip.id}`, 'other-token')
  expect(hiddenTrip.status).toBe(404)
  expect(await hiddenTrip.json()).toMatchObject({ error: 'trip_not_found' })

  const malformedId = await get('/trips/not-a-uuid', 'user-token')
  expect(malformedId.status).toBe(404)
  expect(await malformedId.json()).toMatchObject({ error: 'trip_not_found' })

  const missingTrip = await get(`/trips/${randomUUID()}`, 'user-token')
  expect(missingTrip.status).toBe(404)
  expect(await missingTrip.json()).toMatchObject({ error: 'trip_not_found' })
})

it('exige bearer válido e retorna 400 com os campos da viagem inválidos', async () => {
  const unauthenticated = await get('/trips')
  expect(unauthenticated.status).toBe(401)
  expect(await unauthenticated.json()).toMatchObject({ error: 'unauthorized' })

  const invalidToken = await get('/trips', 'wrong-token')
  expect(invalidToken.status).toBe(401)
  expect(await invalidToken.json()).toMatchObject({ error: 'unauthorized' })

  const invalidTrip = await post(
    '/trips',
    {
      name: ' ',
      destination: 'Lisboa',
      startDate: '2026-10-20',
      endDate: '2026-10-19',
      timezone: 'Europe/Lisbon',
    },
    'user-token',
  )
  expect(invalidTrip.status).toBe(400)
  expect(await invalidTrip.json()).toMatchObject({
    error: 'invalid_trip',
    message: expect.any(String),
    fields: {
      name: expect.any(String),
      endDate: expect.any(String),
    },
  })
})
