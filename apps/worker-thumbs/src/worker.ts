import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  type SQSClientConfig,
} from '@aws-sdk/client-sqs'
import pg from 'pg'
import sharp from 'sharp'
import {
  publishPhotoOutboxBatch,
  TripPhotoNotFoundError,
  TripPhotoStateError,
  type PhotoMessagePublisher,
  type PhotoQueueMessage,
  type PhotoStorage,
  type PhotoStore,
} from '@trippy/adapters/photos'
import type { ThumbWorkerConfig } from './config.ts'

type Pool = InstanceType<typeof pg.Pool>

export type PhotoMessageResult = 'ready' | 'already-ready'

export function parsePhotoMessage(body: string): PhotoQueueMessage {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    throw new Error('Mensagem de miniatura não contém JSON válido')
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('photoId' in value) ||
    typeof value.photoId !== 'string' ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(value.photoId)
  ) {
    throw new Error('Mensagem de miniatura não possui photoId válido')
  }
  return { photoId: value.photoId }
}

export async function processPhotoMessage(
  message: PhotoQueueMessage,
  store: Pick<PhotoStore, 'getForWorker' | 'markReady'>,
  storage: Pick<PhotoStorage, 'readObject' | 'writeThumbnail'>,
): Promise<PhotoMessageResult> {
  const photo = await store.getForWorker(message.photoId)
  if (!photo) throw new TripPhotoNotFoundError()
  if (photo.status === 'ready') return 'already-ready'
  if (photo.status !== 'uploaded') throw new TripPhotoStateError()

  const original = await storage.readObject(photo.s3Key)
  const thumbnail = await sharp(original)
    .rotate()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer()
  await storage.writeThumbnail(`photos/${photo.tripId}/${photo.id}/thumb.jpg`, thumbnail)
  await store.markReady(photo.id)
  return 'ready'
}

function sqsClientConfig(config: ThumbWorkerConfig): SQSClientConfig {
  const credentials =
    config.awsAccessKeyId && config.awsSecretAccessKey
      ? { accessKeyId: config.awsAccessKeyId, secretAccessKey: config.awsSecretAccessKey }
      : undefined
  return {
    region: config.awsRegion,
    ...(config.sqsEndpoint ? { endpoint: config.sqsEndpoint } : {}),
    ...(credentials ? { credentials } : {}),
  }
}

export function createThumbSqsClient(config: ThumbWorkerConfig): SQSClient {
  return new SQSClient(sqsClientConfig(config))
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function resolveThumbQueueUrl(sqs: SQSClient, queueName: string): Promise<string> {
  const result = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }))
  if (!result.QueueUrl) throw new Error(`SQS não retornou URL para a fila ${queueName}`)
  return result.QueueUrl
}

export class ThumbWorker {
  private readonly sqs: SQSClient
  private readonly queueUrl: string
  private readonly publisher: PhotoMessagePublisher

  constructor(
    private readonly pool: Pool,
    private readonly store: Pick<PhotoStore, 'getForWorker' | 'markReady'>,
    private readonly storage: Pick<PhotoStorage, 'readObject' | 'writeThumbnail'>,
    config: ThumbWorkerConfig,
    queueUrl: string,
    sqs?: SQSClient,
  ) {
    this.sqs = sqs ?? createThumbSqsClient(config)
    this.queueUrl = queueUrl
    this.publisher = {
      publish: async (message) => {
        await this.sqs.send(
          new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify(message) }),
        )
      },
    }
  }

  async runOnce(): Promise<{ published: number; received: boolean; processed: boolean }> {
    const published = await publishPhotoOutboxBatch(this.pool, this.publisher, 10)
    const result = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 10,
        VisibilityTimeout: 60,
      }),
    )
    const message = result.Messages?.[0]
    if (!message) return { published, received: false, processed: false }

    if (!message.ReceiptHandle || !message.Body) {
      console.error('Mensagem SQS sem ReceiptHandle ou Body; será retentada e enviada à DLQ.')
      return { published, received: true, processed: false }
    }

    try {
      await processPhotoMessage(parsePhotoMessage(message.Body), this.store, this.storage)
      await this.sqs.send(
        new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.ReceiptHandle }),
      )
      return { published, received: true, processed: true }
    } catch (error) {
      console.error(`Falha ao gerar miniatura; SQS retentará a mensagem: ${describe(error)}`)
      return { published, received: true, processed: false }
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.runOnce()
      } catch (error) {
        console.error(`Falha no ciclo do worker de miniaturas: ${describe(error)}`)
        await wait(1_000, signal)
      }
    }
  }

  close(): void {
    this.sqs.destroy()
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener('abort', finish, { once: true })
  })
}
