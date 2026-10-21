import { randomUUID } from 'node:crypto'
import pg, { type PoolClient } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { migrate } from '../../../db/src/migrate.ts'
import { PostgresTripStore } from './store.ts'

type Pool = InstanceType<typeof pg.Pool>

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')

const testDatabaseName = `trippy_trips_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`

let databaseCreated = false
let pool: Pool

async function createUser(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [`trip-${randomUUID()}@example.test`],
  )
  return result.rows[0]!.id
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

it('cria viagem e organizador na mesma sequência e lista apenas vínculos ativos', async () => {
  const userId = await createUser()
  const store = new PostgresTripStore(pool)
  const trip = await store.createTrip({
    name: 'Férias',
    destination: 'Lisboa',
    startDate: '2026-10-20',
    endDate: '2026-10-22',
    timezone: 'Europe/Lisbon',
    organizerId: userId,
  })

  expect(trip).toMatchObject({
    name: 'Férias',
    destination: 'Lisboa',
    startDate: '2026-10-20',
    endDate: '2026-10-22',
    timezone: 'Europe/Lisbon',
    role: 'organizer',
  })

  const persisted = await pool.query<{
    trip_seq: string
    seq_counter: string
    member_seq: string
    role: string
  }>(
    `SELECT trips.seq AS trip_seq, trips.seq_counter, trip_members.seq AS member_seq, trip_members.role
     FROM trips JOIN trip_members ON trip_members.trip_id = trips.id WHERE trips.id = $1`,
    [trip.id],
  )
  expect(persisted.rows[0]).toMatchObject({
    trip_seq: '1',
    seq_counter: '2',
    member_seq: '2',
    role: 'organizer',
  })
  expect(await store.listTripsForUser(userId)).toHaveLength(1)
  expect(await store.getTripForMember(userId, trip.id)).toMatchObject({ id: trip.id })

  await pool.query('UPDATE trip_members SET left_at = now() WHERE trip_id = $1 AND user_id = $2', [
    trip.id,
    userId,
  ])
  expect(await store.listTripsForUser(userId)).toEqual([])
  expect(await store.getTripForMember(userId, trip.id)).toBeNull()
})

it('desfaz a viagem quando o insert do organizador falha', async () => {
  const userId = await createUser()
  const failingPool = {
    query: pool.query.bind(pool),
    connect: async () => {
      const client = await pool.connect()
      return {
        query: (sql: string, values?: unknown[]) => {
          const failedInsert = sql.startsWith('INSERT INTO trip_members')
            ? sql.replace("'organizer'", "'invalid_role'")
            : sql
          return client.query(failedInsert, values as never)
        },
        release: () => client.release(),
      } as unknown as PoolClient
    },
  } as unknown as Pool
  const store = new PostgresTripStore(failingPool)

  await expect(
    store.createTrip({
      name: 'Falha controlada',
      destination: 'Lisboa',
      startDate: '2026-10-20',
      endDate: '2026-10-22',
      timezone: 'Europe/Lisbon',
      organizerId: userId,
    }),
  ).rejects.toThrow()

  const trips = await pool.query<{ count: string }>(
    "SELECT count(*) FROM trips WHERE name = 'Falha controlada'",
  )
  expect(trips.rows[0]?.count).toBe('0')
})
