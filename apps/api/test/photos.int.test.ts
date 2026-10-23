import { randomUUID } from 'node:crypto'
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PostgresPhotoStore, S3PhotoStorage } from '@trippy/adapters/photos'
import { PostgresTripStore } from '@trippy/adapters/trips'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { createApp } from '../src/app.ts'
import { createPhotosRouter } from '../src/trips/photos-router.ts'
import type { HealthChecks } from '../src/health.ts'

type Pool = InstanceType<typeof pg.Pool>

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')

const testDatabaseName = `trippy_api_photos_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`
const bucket = `trippy-photos-api-${process.pid}-${randomUUID().replaceAll('-', '').slice(0, 8)}`
const endpoint = process.env.S3_ENDPOINT?.trim()
if (!endpoint) throw new Error('S3_ENDPOINT não definido: configure o MinIO local')
const region = process.env.AWS_REGION ?? 'us-east-1'
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? 'trippy'
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? 'trippy-dev-secret'
const forcePathStyle = process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() === 'true'

const s3Config: S3ClientConfig = {
  region,
  endpoint,
  forcePathStyle,
  credentials: { accessKeyId, secretAccessKey },
}
const adminS3 = new S3Client(s3Config)

const tokenUsers = new Map<string, string>()
let databaseCreated = false
let bucketCreated = false
let pool: Pool
let photoStore: PostgresPhotoStore
let storage: S3PhotoStorage
let app: ReturnType<typeof createApp>
let userId: string
let otherUserId: string
let tripId: string

const healthyChecks: HealthChecks = {
  postgres: async () => {},
  storage: async () => {},
  queue: async () => {},
  mail: async () => {},
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

async function get(path: string, token?: string) {
  return app.request(path, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
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

  await adminS3.send(new CreateBucketCommand({ Bucket: bucket }))
  bucketCreated = true
  await migrate({ databaseUrl: testDatabaseUrl.toString() })
  pool = new pg.Pool({ connectionString: testDatabaseUrl.toString() })
  const users = await pool.query<{ id: string }>(
    'INSERT INTO users (email) VALUES ($1), ($2) RETURNING id',
    [`photos-api-${randomUUID()}@example.test`, `photos-api-${randomUUID()}@example.test`],
  )
  userId = users.rows[0]!.id
  otherUserId = users.rows[1]!.id
  tokenUsers.set('member-token', userId)
  tokenUsers.set('other-token', otherUserId)
  const trip = await new PostgresTripStore(pool).createTrip({
    name: 'Fotos da viagem',
    destination: 'Xangai',
    startDate: '2026-10-20',
    endDate: '2026-10-22',
    timezone: 'Asia/Shanghai',
    organizerId: userId,
  })
  tripId = trip.id
  photoStore = new PostgresPhotoStore(pool)
  storage = new S3PhotoStorage({
    bucket,
    region,
    endpoint,
    forcePathStyle,
    accessKeyId,
    secretAccessKey,
  })
  const photos = createPhotosRouter(
    {
      databaseUrl: testDatabaseUrl.toString(),
      awsRegion: region,
      s3Endpoint: endpoint,
      s3ForcePathStyle: forcePathStyle,
      s3BucketPhotos: bucket,
    },
    {
      accessTokenVerifier: async (token) => {
        const verifiedUserId = tokenUsers.get(token)
        if (!verifiedUserId) throw new Error('Token inválido')
        return { userId: verifiedUserId }
      },
      photoStore,
      photoStorage: storage,
    },
  )
  app = createApp(
    healthyChecks,
    1_000,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    photos.router,
  )
})

afterAll(async () => {
  if (pool) await pool.end()
  if (storage) storage.close()
  if (bucketCreated) {
    const listed = await adminS3.send(new ListObjectsV2Command({ Bucket: bucket }))
    if (listed.Contents?.length) {
      await adminS3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: listed.Contents.flatMap(({ Key }) => (Key ? [{ Key }] : [])) },
        }),
      )
    }
    await adminS3.send(new DeleteBucketCommand({ Bucket: bucket }))
  }
  adminS3.destroy()
  if (!databaseCreated) return

  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE "${testDatabaseName}"`)
  } finally {
    await admin.end()
  }
})

it('reserva, faz PUT no host assinado, confirma sem duplicar e entrega miniatura autenticável', async () => {
  const photoId = randomUUID()
  const metadata = {
    id: photoId,
    takenAtOriginal: '2026-10-20T13:45:12',
    takenTz: 'Asia/Shanghai',
    lat: 31.2304,
    lng: 121.4737,
  }
  const path = `/trips/${tripId}/photos/uploads`
  const first = await post(path, metadata, 'member-token')
  expect(first.status).toBe(201)
  const reservation = (await first.json()) as { id: string; uploadUrl: string }
  expect(reservation.id).toBe(photoId)
  expect(new URL(reservation.uploadUrl).host).toBe(new URL(endpoint).host)

  const repeated = await post(path, metadata, 'member-token')
  expect(repeated.status).toBe(201)
  expect(await repeated.json()).toMatchObject({ id: photoId, uploadUrl: expect.any(String) })
  const count = await pool.query<{ count: string }>('SELECT count(*) FROM photos WHERE id = $1', [
    photoId,
  ])
  expect(count.rows[0]?.count).toBe('1')

  const uploadedBeforePut = await post(
    `/trips/${tripId}/photos/${photoId}/complete`,
    {},
    'member-token',
  )
  expect(uploadedBeforePut.status).toBe(409)

  const put = await fetch(reservation.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  })
  expect(put.status).toBe(200)
  const original = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

  const completed = await post(`/trips/${tripId}/photos/${photoId}/complete`, {}, 'member-token')
  const completedAgain = await post(
    `/trips/${tripId}/photos/${photoId}/complete`,
    {},
    'member-token',
  )
  expect(completed.status).toBe(200)
  expect(completedAgain.status).toBe(200)
  expect(await completed.json()).toEqual({ id: photoId })

  const reservedAfterCompletion = await post(path, metadata, 'member-token')
  expect(reservedAfterCompletion.status).toBe(201)
  const repeatedReservation = (await reservedAfterCompletion.json()) as {
    id: string
    uploadUrl: string
  }
  const repeatedPut = await fetch(repeatedReservation.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0xff, 0xd9]),
  })
  expect(repeatedPut.status).toBe(200)
  expect(await storage.readObject(`photos/${tripId}/${photoId}/original.jpg`)).toEqual(original)
  const completedAfterRepeatedPut = await post(
    `/trips/${tripId}/photos/${photoId}/complete`,
    {},
    'member-token',
  )
  expect(completedAfterRepeatedPut.status).toBe(200)
  expect(await storage.hasJpeg(`photos/${tripId}/${photoId}/upload.jpg`)).toBe(false)
  const outboxCount = await pool.query<{ count: string }>(
    'SELECT count(*) FROM photo_outbox WHERE photo_id = $1',
    [photoId],
  )
  expect(outboxCount.rows[0]?.count).toBe('1')

  const unauthorized = await get(`/trips/${tripId}/photos`, 'other-token')
  expect(unauthorized.status).toBe(404)
  const beforeThumbnail = await get(`/trips/${tripId}/photos`, 'member-token')
  expect(await beforeThumbnail.json()).toMatchObject({
    photos: [
      {
        id: photoId,
        status: 'uploaded',
        placeId: null,
        takenAtOriginal: metadata.takenAtOriginal,
        takenTz: metadata.takenTz,
        lat: metadata.lat,
        lng: metadata.lng,
        thumbnailUrl: null,
      },
    ],
  })

  const thumbnail = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
  await storage.writeThumbnail(`photos/${tripId}/${photoId}/thumb.jpg`, thumbnail)
  await photoStore.markReady(photoId)
  const ready = await get(`/trips/${tripId}/photos`, 'member-token')
  const readyBody = (await ready.json()) as {
    photos: Array<{ id: string; thumbnailUrl: string | null }>
  }
  expect(readyBody.photos[0]?.thumbnailUrl).toBeTruthy()
  expect(new URL(readyBody.photos[0]!.thumbnailUrl!).host).toBe(new URL(endpoint).host)
  const downloaded = await fetch(readyBody.photos[0]!.thumbnailUrl!)
  expect(downloaded.status).toBe(200)
  expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(thumbnail)
})

it('recusa autenticação ausente, reserva inválida e viagem sem associação', async () => {
  const unauthenticated = await get(`/trips/${tripId}/photos`)
  expect(unauthenticated.status).toBe(401)
  const invalidPhoto = await post(
    `/trips/${tripId}/photos/uploads`,
    { id: 'id-invalido' },
    'member-token',
  )
  expect(invalidPhoto.status).toBe(400)
  const notMember = await post(
    `/trips/${tripId}/photos/uploads`,
    { id: randomUUID() },
    'other-token',
  )
  expect(notMember.status).toBe(404)
})
