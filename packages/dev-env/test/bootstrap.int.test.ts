import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GetQueueAttributesCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs'
import { HeadBucketCommand } from '@aws-sdk/client-s3'
import { beforeAll, describe, expect, it } from 'vitest'
import { bootstrapResources, createS3Client, createSqsClient } from '../src/bootstrap.ts'
import { resourcesFor } from '../src/resources.ts'

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env')

describe('bootstrap do ambiente local', () => {
  beforeAll(() => {
    process.loadEnvFile(envPath)
  })

  it('cria buckets e filas idempotentemente com DLQs', async () => {
    await bootstrapResources()
    await bootstrapResources()

    const s3 = createS3Client()
    const sqs = createSqsClient()
    const { buckets, queues } = resourcesFor()

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
