import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import pg from 'pg'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import type { ThumbWorkerConfig } from './config.ts'
import { parsePhotoMessage, processPhotoMessage, ThumbWorker } from './worker.ts'

type Pool = InstanceType<typeof pg.Pool>

const photoId = 'ca3537e0-abc4-4e1a-ae6a-fc1ad60c75c2'

it('valida mensagem da fila e ignora chaves adicionais', () => {
  expect(parsePhotoMessage(JSON.stringify({ photoId, source: 'outbox' }))).toEqual({ photoId })
  expect(() => parsePhotoMessage('{')).toThrow(/JSON válido/u)
  expect(() => parsePhotoMessage(JSON.stringify({ photoId: 'inválido' }))).toThrow(/photoId/u)
})

it('gera JPEG limitado, grava na chave estável e confirma idempotentemente', async () => {
  const original = await sharp({
    create: { width: 900, height: 700, channels: 3, background: '#cc9966' },
  })
    .jpeg()
    .toBuffer()
  let status: 'uploaded' | 'ready' = 'uploaded'
  const written: Array<{ key: string; body: Uint8Array }> = []
  let reads = 0
  const store = {
    getForWorker: async () => ({
      id: photoId,
      tripId: '93f9d4f0-b884-48aa-bafb-2ead95f90488',
      userId: '873a30be-7cbc-4ec6-81c9-9399540e37a9',
      s3Key:
        'photos/93f9d4f0-b884-48aa-bafb-2ead95f90488/ca3537e0-abc4-4e1a-ae6a-fc1ad60c75c2/original.jpg',
      takenAtOriginal: null,
      takenTz: null,
      lat: null,
      lng: null,
      status,
      createdAt: new Date(),
    }),
    markReady: async () => {
      status = 'ready'
    },
  }
  const storage = {
    readObject: async () => {
      reads += 1
      return original
    },
    writeThumbnail: async (key: string, body: Uint8Array) => {
      written.push({ key, body })
    },
  }

  await expect(processPhotoMessage({ photoId }, store, storage)).resolves.toBe('ready')
  await expect(processPhotoMessage({ photoId }, store, storage)).resolves.toBe('already-ready')
  expect(reads).toBe(1)
  expect(written).toHaveLength(1)
  expect(written[0]?.key).toBe(
    'photos/93f9d4f0-b884-48aa-bafb-2ead95f90488/ca3537e0-abc4-4e1a-ae6a-fc1ad60c75c2/thumb.jpg',
  )
  const metadata = await sharp(written[0]!.body).metadata()
  expect(metadata.format).toBe('jpeg')
  expect(metadata.width).toBeLessThanOrEqual(512)
  expect(metadata.height).toBeLessThanOrEqual(512)
})

it('mantém mensagem falha sem confirmação para retry e DLQ da fila', async () => {
  const commands: unknown[] = []
  const fakeSqs = {
    send: async (command: unknown) => {
      commands.push(command)
      if (command instanceof ReceiveMessageCommand) {
        return { Messages: [{ Body: JSON.stringify({ photoId }), ReceiptHandle: 'receipt-1' }] }
      }
      return {}
    },
    destroy: () => {},
  } as unknown as SQSClient
  const fakeClient = {
    query: async () => ({ rows: [] }),
    release: () => {},
  }
  const fakePool = { connect: async () => fakeClient } as unknown as Pool
  const config: ThumbWorkerConfig = {
    databaseUrl: 'postgres://unused',
    s3ForcePathStyle: true,
    s3BucketPhotos: 'thumbs-test-bucket',
    sqsQueueThumbs: 'thumbs-test-queue',
    awsRegion: 'us-east-1',
  }
  const worker = new ThumbWorker(
    fakePool,
    {
      getForWorker: async () => ({
        id: photoId,
        tripId: '93f9d4f0-b884-48aa-bafb-2ead95f90488',
        userId: '873a30be-7cbc-4ec6-81c9-9399540e37a9',
        s3Key: 'photos/original.jpg',
        takenAtOriginal: null,
        takenTz: null,
        lat: null,
        lng: null,
        status: 'uploaded',
        createdAt: new Date(),
      }),
      markReady: async () => {},
    },
    {
      readObject: async () => {
        throw new Error('JPEG inválido')
      },
      writeThumbnail: async () => {},
    },
    config,
    'https://queue.invalid/thumbs',
    fakeSqs,
  )

  await expect(worker.runOnce()).resolves.toEqual({
    published: 0,
    received: true,
    processed: false,
  })
  expect(commands.some((command) => command instanceof DeleteMessageCommand)).toBe(false)
  worker.close()
})
