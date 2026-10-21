import { randomUUID } from 'node:crypto'
import { DeleteBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import {
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
} from '@aws-sdk/client-sqs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootstrapResources, createS3Client, createSqsClient } from '../src/bootstrap.ts'
import { resourcesFor } from '../src/resources.ts'

const requiredEnvironment = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'S3_ENDPOINT',
  'SQS_ENDPOINT',
]

const suffix = `${process.pid}-${randomUUID().replaceAll('-', '').slice(0, 8)}`
const isolatedEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  S3_BUCKET_PHOTOS: `trippy-photos-test-${suffix}`,
  S3_BUCKET_VIDEOS: `trippy-videos-test-${suffix}`,
  SQS_QUEUE_THUMBS: `trippy-thumbs-test-${suffix}`,
  SQS_QUEUE_RECAP: `trippy-recap-test-${suffix}`,
}
let shouldCleanup = false

afterAll(async () => {
  if (!shouldCleanup) return
  const s3 = createS3Client(isolatedEnvironment)
  const sqs = createSqsClient(isolatedEnvironment)
  const { buckets, queues } = resourcesFor(isolatedEnvironment)
  try {
    for (const queue of queues) {
      const queueUrl = (
        await sqs.send(new GetQueueUrlCommand({ QueueName: queue.name })).catch(() => undefined)
      )?.QueueUrl
      const deadLetterQueueUrl = (
        await sqs
          .send(new GetQueueUrlCommand({ QueueName: queue.deadLetterQueueName }))
          .catch(() => undefined)
      )?.QueueUrl
      if (queueUrl) await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }))
      if (deadLetterQueueUrl) {
        await sqs.send(new DeleteQueueCommand({ QueueUrl: deadLetterQueueUrl }))
      }
    }
    for (const bucket of buckets) {
      await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined)
    }
  } finally {
    s3.destroy()
    sqs.destroy()
  }
})

describe('bootstrap do ambiente local', () => {
  beforeAll(() => {
    const missing = requiredEnvironment.filter((name) => !process.env[name]?.trim())
    if (missing.length > 0) {
      throw new Error(
        `Teste de integração do bootstrap exige ${missing.join(', ')}. Configure essas variáveis no .env da raiz.`,
      )
    }
    shouldCleanup = true
  })

  it('cria buckets e filas idempotentemente com DLQs', async () => {
    await bootstrapResources(isolatedEnvironment)
    await bootstrapResources(isolatedEnvironment)

    const s3 = createS3Client(isolatedEnvironment)
    const sqs = createSqsClient(isolatedEnvironment)
    const { buckets, queues } = resourcesFor(isolatedEnvironment)

    for (const bucket of buckets) {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }))
    }

    for (const queue of queues) {
      const queueUrl = (await sqs.send(new GetQueueUrlCommand({ QueueName: queue.name }))).QueueUrl
      const deadLetterQueueUrl = (
        await sqs.send(new GetQueueUrlCommand({ QueueName: queue.deadLetterQueueName }))
      ).QueueUrl

      expect(queueUrl).toBeDefined()
      expect(deadLetterQueueUrl).toBeDefined()

      const queueAttributes = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['RedrivePolicy', 'VisibilityTimeout'],
        }),
      )
      const deadLetterQueueAttributes = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: deadLetterQueueUrl,
          AttributeNames: ['QueueArn'],
        }),
      )

      expect(queueAttributes.Attributes?.VisibilityTimeout).toBe(
        String(queue.visibilityTimeoutSeconds),
      )
      const redrivePolicy = JSON.parse(queueAttributes.Attributes?.RedrivePolicy ?? 'null') as {
        deadLetterTargetArn: string
        maxReceiveCount: number | string
      }

      expect(redrivePolicy.deadLetterTargetArn).toBe(deadLetterQueueAttributes.Attributes?.QueueArn)
      expect(String(redrivePolicy.maxReceiveCount)).toBe('5')
    }
  })
})
