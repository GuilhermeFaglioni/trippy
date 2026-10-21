import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  PostgresPhotoStore,
  publishPhotoOutboxBatch,
  TripPhotoConflictError,
  TripPhotoNotFoundError,
} from './store.ts'
import { PostgresTripStore } from '../trips/store.ts'
import { migrate } from '../../../db/src/migrate.ts'

type Pool = InstanceType<typeof pg.Pool>

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')

const testDatabaseName = `trippy_photos_store_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`

let databaseCreated = false
let pool: Pool
let store: PostgresPhotoStore
let userId: string
let otherUserId: string
let tripId: string

const photoId = 'ca3537e0-abc4-4e1a-ae6a-fc1ad60c75c2'
const metadata = {
  id: photoId,
  takenAtOriginal: '2026-10-20T13:45:12',
  takenTz: 'Asia/Shanghai',
  lat: 31.2304,
  lng: 121.4737,
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
    [`photos-${randomUUID()}@example.test`, `photos-${randomUUID()}@example.test`],
  )
  userId = users.rows[0]!.id
  otherUserId = users.rows[1]!.id
  const trip = await new PostgresTripStore(pool).createTrip({
    name: 'Viagem das fotos',
    destination: 'Xangai',
    startDate: '2026-10-20',
    endDate: '2026-10-22',
    timezone: 'Asia/Shanghai',
    organizerId: userId,
  })
  tripId = trip.id
  await pool.query(`INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1, $2, 'member')`, [
    tripId,
    otherUserId,
  ])
  store = new PostgresPhotoStore(pool)
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

it('reserva UUID idempotente, preserva metadados e exige vínculo ativo', async () => {
  const first = await store.reserveForMember(userId, tripId, metadata)
  const retry = await store.reserveForMember(userId, tripId, metadata)

  expect(first).toMatchObject({
    id: photoId,
    tripId,
    userId,
    s3Key: `photos/${tripId}/${photoId}/original.jpg`,
    takenAtOriginal: metadata.takenAtOriginal,
    takenTz: metadata.takenTz,
    lat: metadata.lat,
    lng: metadata.lng,
    status: 'pending',
  })
  expect(retry.id).toBe(first.id)
  await expect(store.reserveForMember(otherUserId, tripId, metadata)).rejects.toBeInstanceOf(
    TripPhotoConflictError,
  )
  await expect(
    store.reserveForMember(otherUserId, randomUUID(), { ...metadata, id: randomUUID() }),
  ).rejects.toBeInstanceOf(TripPhotoNotFoundError)

  const count = await pool.query<{ count: string }>('SELECT count(*) FROM photos WHERE id = $1', [
    photoId,
  ])
  expect(count.rows[0]?.count).toBe('1')
})

it('confirma idempotentemente e grava outbox na mesma transação', async () => {
  const first = await store.completeForMember(userId, tripId, photoId)
  const retry = await store.completeForMember(userId, tripId, photoId)
  expect(first.status).toBe('uploaded')
  expect(retry.status).toBe('uploaded')

  const rows = await pool.query<{ count: string; published: number }>(
    `SELECT count(*) AS count, count(*) FILTER (WHERE published_at IS NOT NULL)::integer AS published
     FROM photo_outbox WHERE photo_id = $1`,
    [photoId],
  )
  expect(rows.rows[0]).toEqual({ count: '1', published: 0 })

  const listed = await store.listForMember(userId, tripId)
  expect(listed).toEqual([
    {
      id: photoId,
      status: 'uploaded',
      placeId: null,
      takenAtOriginal: metadata.takenAtOriginal,
      takenTz: metadata.takenTz,
      lat: metadata.lat,
      lng: metadata.lng,
    },
  ])
  expect(await store.listForMember(randomUUID(), tripId)).toBeNull()
})

it('mantém outbox em falha de publicação e reconcilia depois com entrega repetível', async () => {
  const failed = await publishPhotoOutboxBatch(pool, {
    publish: async () => {
      throw new Error('SQS indisponível')
    },
  })
  expect(failed).toBe(0)

  const failedRow = await pool.query<{
    attempts: number
    last_error: string
    published_at: Date | null
  }>('SELECT attempts, last_error, published_at FROM photo_outbox WHERE photo_id = $1', [photoId])
  expect(failedRow.rows[0]).toMatchObject({
    attempts: 1,
    last_error: 'SQS indisponível',
    published_at: null,
  })

  await pool.query('UPDATE photo_outbox SET available_at = clock_timestamp() WHERE photo_id = $1', [
    photoId,
  ])
  const publishedMessages: string[] = []
  const published = await publishPhotoOutboxBatch(pool, {
    publish: async ({ photoId: queuedPhotoId }) => {
      publishedMessages.push(queuedPhotoId)
    },
  })
  expect(published).toBe(1)
  expect(publishedMessages).toEqual([photoId])
  expect(await publishPhotoOutboxBatch(pool, { publish: async () => {} })).toBe(0)
})
