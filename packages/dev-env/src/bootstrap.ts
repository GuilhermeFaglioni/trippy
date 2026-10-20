import { CreateBucketCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3'
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  QueueAttributeName,
  SQSClient,
  type SQSClientConfig,
} from '@aws-sdk/client-sqs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resourcesFor } from './resources.ts'

type Environment = NodeJS.ProcessEnv

function credentialsFor(environment: Environment) {
  const accessKeyId = environment.AWS_ACCESS_KEY_ID?.trim()
  const secretAccessKey = environment.AWS_SECRET_ACCESS_KEY?.trim()

  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error('AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY precisam estar definidas juntas.')
  }

  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined
}

function regionFor(environment: Environment): string {
  return environment.AWS_REGION?.trim() || 'us-east-1'
}

export function createS3Client(environment: Environment = process.env): S3Client {
  const endpoint = environment.S3_ENDPOINT?.trim()
  const credentials = credentialsFor(environment)
  const config: S3ClientConfig = {
    region: regionFor(environment),
    forcePathStyle: environment.S3_FORCE_PATH_STYLE?.trim().toLowerCase() === 'true',
    ...(endpoint ? { endpoint } : {}),
    ...(credentials ? { credentials } : {}),
  }

  return new S3Client(config)
}

export function createSqsClient(environment: Environment = process.env): SQSClient {
  const endpoint = environment.SQS_ENDPOINT?.trim()
  const credentials = credentialsFor(environment)
  const config: SQSClientConfig = {
    region: regionFor(environment),
    ...(endpoint ? { endpoint } : {}),
    ...(credentials ? { credentials } : {}),
  }

  return new SQSClient(config)
}

function hasErrorName(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === name
}

async function createBucketIfMissing(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }))
  } catch (error) {
    if (!hasErrorName(error, 'BucketAlreadyOwnedByYou')) {
      throw error
    }
  }
}

async function createQueue(
  sqs: SQSClient,
  queueName: string,
  attributes?: Record<string, string>,
): Promise<string> {
  const result = await sqs.send(
    new CreateQueueCommand({
      QueueName: queueName,
      ...(attributes ? { Attributes: attributes } : {}),
    }),
  )

  if (!result.QueueUrl) {
    throw new Error(`ElasticMQ não retornou URL para a fila "${queueName}".`)
  }

  return result.QueueUrl
}

async function queueArn(sqs: SQSClient, queueUrl: string): Promise<string> {
  const result = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: [QueueAttributeName.QueueArn],
    }),
  )
  const arn = result.Attributes?.[QueueAttributeName.QueueArn]

  if (!arn) {
    throw new Error(`ElasticMQ não retornou ARN para a fila "${queueUrl}".`)
  }

  return arn
}

export async function bootstrapResources(environment: Environment = process.env): Promise<void> {
  const s3 = createS3Client(environment)
  const sqs = createSqsClient(environment)
  const resources = resourcesFor(environment)

  try {
    for (const bucket of resources.buckets) {
      await createBucketIfMissing(s3, bucket)
    }

    for (const queue of resources.queues) {
      const deadLetterQueueUrl = await createQueue(sqs, queue.deadLetterQueueName)
      const deadLetterQueueArn = await queueArn(sqs, deadLetterQueueUrl)

      await createQueue(sqs, queue.name, {
        [QueueAttributeName.VisibilityTimeout]: String(queue.visibilityTimeoutSeconds),
        [QueueAttributeName.RedrivePolicy]: JSON.stringify({
          deadLetterTargetArn: deadLetterQueueArn,
          maxReceiveCount: '5',
        }),
      })
    }
  } finally {
    s3.destroy()
    sqs.destroy()
  }
}

const currentFile = fileURLToPath(import.meta.url)

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  try {
    await bootstrapResources()
    console.log('Buckets e filas locais prontos.')
  } catch (error) {
    console.error('Falha ao preparar os recursos locais:', error)
    process.exitCode = 1
  }
}
