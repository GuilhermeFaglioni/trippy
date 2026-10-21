import { randomUUID } from 'node:crypto'
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  QueueAttributeName,
  SendMessageCommand,
  SQSClient,
  type SQSClientConfig,
} from '@aws-sdk/client-sqs'
import pg from 'pg'
import sharp from 'sharp'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { photoUploadKey, PostgresPhotoStore, S3PhotoStorage } from '@trippy/adapters/photos'
import { PostgresTripStore } from '@trippy/adapters/trips'
import { migrate } from '../../../packages/db/src/migrate.ts'
import type { ThumbWorkerConfig } from '../src/config.ts'
import { resolveThumbQueueUrl, ThumbWorker } from '../src/worker.ts'

type Pool = InstanceType<typeof pg.Pool>

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')
const s3Endpoint = process.env.S3_ENDPOINT?.trim()
const sqsEndpoint = process.env.SQS_ENDPOINT?.trim()
if (!s3Endpoint || !sqsEndpoint) {
  throw new Error(
    'S3_ENDPOINT e SQS_ENDPOINT precisam estar definidos para o worker de integração.',
  )
}

const suffix = `${process.pid}-${randomUUID().replaceAll('-', '').slice(0, 8)}`
const testDatabaseName = `trippy_thumbs_${suffix}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testDatabaseUrl = new URL(databaseUrl)
testDatabaseUrl.pathname = `/${testDatabaseName}`
const bucket = `trippy-thumbs-test-${suffix}`
const queueName = `trippy-thumbs-test-${suffix}`
const deadLetterQueueName = `${queueName}-dlq`
const region = process.env.AWS_REGION ?? 'us-east-1'
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? 'trippy'
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? 'trippy-dev-secret'
const forcePathStyle = process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() === 'true'
const s3Config: S3ClientConfig = {
  region,
  endpoint: s3Endpoint,
  forcePathStyle,
  credentials: { accessKeyId, secretAccessKey },
}
const sqsConfig: SQSClientConfig = {
  region,
  endpoint: sqsEndpoint,
  credentials: { accessKeyId, secretAccessKey },
}
const adminS3 = new S3Client(s3Config)
const sqs = new SQSClient(sqsConfig)

let databaseCreated = false
let bucketCreated = false
let queueCreated = false
let deadLetterQueueCreated = false
let pool: Pool
let photoStore: PostgresPhotoStore
let storage: S3PhotoStorage
let worker: ThumbWorker
let tripId: string
let photoId: string
let queueUrl: string
let originalImage: Uint8Array<ArrayBuffer>
let uploadUrl: string

const workerConfig: ThumbWorkerConfig = {
  databaseUrl: testDatabaseUrl.toString(),
  s3Endpoint,
  s3ForcePathStyle: forcePathStyle,
  s3BucketPhotos: bucket,
  sqsEndpoint,
  sqsQueueThumbs: queueName,
  awsRegion: region,
  awsAccessKeyId: accessKeyId,
  awsSecretAccessKey: secretAccessKey,
}

async function createQueue(name: string, attributes?: Record<string, string>): Promise<string> {
  const result = await sqs.send(
    new CreateQueueCommand({ QueueName: name, ...(attributes ? { Attributes: attributes } : {}) }),
  )
  if (!result.QueueUrl) throw new Error(`ElasticMQ não retornou URL para ${name}`)
  return result.QueueUrl
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
  const deadLetterQueueUrl = await createQueue(deadLetterQueueName)
  deadLetterQueueCreated = true
  const deadLetterAttributes = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: deadLetterQueueUrl,
      AttributeNames: [QueueAttributeName.QueueArn],
    }),
  )
  const deadLetterArn = deadLetterAttributes.Attributes?.[QueueAttributeName.QueueArn]
  if (!deadLetterArn) throw new Error('ElasticMQ não retornou ARN para a DLQ de teste')
  queueUrl = await createQueue(queueName, {
    [QueueAttributeName.VisibilityTimeout]: '60',
    [QueueAttributeName.RedrivePolicy]: JSON.stringify({
      deadLetterTargetArn: deadLetterArn,
      maxReceiveCount: '5',
    }),
  })
  queueCreated = true

  await migrate({ databaseUrl: testDatabaseUrl.toString() })
  pool = new pg.Pool({ connectionString: testDatabaseUrl.toString() })
  const user = await pool.query<{ id: string }>(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [`thumbs-${randomUUID()}@example.test`],
  )
  const trip = await new PostgresTripStore(pool).createTrip({
    name: 'Miniaturas',
    destination: 'Xangai',
    startDate: '2026-10-20',
    endDate: '2026-10-22',
    timezone: 'Asia/Shanghai',
    organizerId: user.rows[0]!.id,
  })
  tripId = trip.id
  photoStore = new PostgresPhotoStore(pool)
  storage = new S3PhotoStorage({
    bucket,
    region,
    endpoint: s3Endpoint,
    forcePathStyle,
    accessKeyId,
    secretAccessKey,
  })

  photoId = randomUUID()
  const reservation = await photoStore.reserveForMember(user.rows[0]!.id, tripId, {
    id: photoId,
    takenAtOriginal: null,
    takenTz: null,
    lat: null,
    lng: null,
  })
  originalImage = new Uint8Array(
    await sharp({
      create: { width: 1200, height: 900, channels: 3, background: '#ba8060' },
    })
      .jpeg()
      .toBuffer(),
  )
  uploadUrl = await storage.createUploadUrl(photoUploadKey(tripId, photoId))
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: originalImage,
  })
  if (!upload.ok) throw new Error(`PUT MinIO falhou com HTTP ${upload.status}`)
  await expect(
    photoStore.completeForMember(user.rows[0]!.id, tripId, photoId, async (photo) => {
      await storage.promoteUpload(photoUploadKey(tripId, photoId), photo.s3Key)
      throw new Error('falha simulada após cópia, antes do commit')
    }),
  ).rejects.toThrow('falha simulada após cópia, antes do commit')
  expect(await photoStore.getForWorker(photoId)).toMatchObject({ status: 'pending' })
  expect(Buffer.from(await storage.readObject(reservation.s3Key))).toEqual(
    Buffer.from(originalImage),
  )
  await photoStore.completeForMember(user.rows[0]!.id, tripId, photoId, async (photo) => {
    await storage.promoteUpload(photoUploadKey(tripId, photoId), photo.s3Key)
  })

  const replacementImage = new Uint8Array(
    await sharp({
      create: { width: 1200, height: 900, channels: 3, background: '#3274b9' },
    })
      .jpeg()
      .toBuffer(),
  )
  const repeatedUpload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: replacementImage,
  })
  if (!repeatedUpload.ok)
    throw new Error(`PUT repetido no MinIO falhou com HTTP ${repeatedUpload.status}`)
  expect(Buffer.from(await storage.readObject(reservation.s3Key))).toEqual(
    Buffer.from(originalImage),
  )
  worker = new ThumbWorker(pool, photoStore, storage, workerConfig, queueUrl)
})

afterAll(async () => {
  if (worker) worker.close()
  if (storage) storage.close()
  if (pool) await pool.end()
  if (queueCreated) await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }))
  if (deadLetterQueueCreated) {
    const url = (
      await sqs
        .send(new GetQueueUrlCommand({ QueueName: deadLetterQueueName }))
        .catch(() => undefined)
    )?.QueueUrl
    if (url) await sqs.send(new DeleteQueueCommand({ QueueUrl: url }))
  }
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
  sqs.destroy()
  if (!databaseCreated) return

  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE "${testDatabaseName}"`)
  } finally {
    await admin.end()
  }
})

it('reconcilia outbox na fila isolada, gera JPEG e aceita mensagem repetida', async () => {
  expect(await resolveThumbQueueUrl(sqs, queueName)).toBe(queueUrl)
  const first = await worker.runOnce()
  expect(first).toEqual({ published: 1, received: true, processed: true })
  expect(await photoStore.getForWorker(photoId)).toMatchObject({ status: 'ready' })

  const thumbnailUrl = await storage.createThumbnailUrl(`photos/${tripId}/${photoId}/thumb.jpg`)
  const thumbnailResponse = await fetch(thumbnailUrl)
  expect(thumbnailResponse.status).toBe(200)
  const thumbnail = Buffer.from(await thumbnailResponse.arrayBuffer())
  const expectedThumbnail = await sharp(originalImage)
    .rotate()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()
  expect(thumbnail).toEqual(expectedThumbnail)
  const thumbnailMetadata = await sharp(thumbnail).metadata()
  expect(thumbnailMetadata.format).toBe('jpeg')
  expect(thumbnailMetadata.width).toBeLessThanOrEqual(512)
  expect(thumbnailMetadata.height).toBeLessThanOrEqual(512)

  await sqs.send(
    new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ photoId }) }),
  )
  expect(await worker.runOnce()).toEqual({ published: 0, received: true, processed: true })
  expect(await photoStore.getForWorker(photoId)).toMatchObject({ status: 'ready' })

  const queueAttributes = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: [QueueAttributeName.RedrivePolicy],
    }),
  )
  const redrivePolicy = JSON.parse(
    queueAttributes.Attributes?.[QueueAttributeName.RedrivePolicy] ?? 'null',
  ) as { deadLetterTargetArn: string; maxReceiveCount: number | string }
  expect(redrivePolicy.deadLetterTargetArn).toBeTruthy()
  expect(String(redrivePolicy.maxReceiveCount)).toBe('5')
})
