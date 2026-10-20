import {
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs'
import type { DispatcherConfig } from './config.ts'

export type RenderQueueMessage = Readonly<{ jobId: string; generation: number }>

export function createQueueClient(
  config: Pick<DispatcherConfig, 'sqsEndpoint' | 'region' | 'accessKeyId' | 'secretAccessKey'>,
): SQSClient {
  return new SQSClient({
    endpoint: config.sqsEndpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

export function parseRenderQueueMessage(body: string): RenderQueueMessage {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    throw new Error('Mensagem de render não contém JSON válido')
  }

  if (
    typeof value !== 'object' ||
    value === null ||
    !('jobId' in value) ||
    typeof value.jobId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.jobId,
    ) ||
    !('generation' in value) ||
    typeof value.generation !== 'number' ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1
  ) {
    throw new Error('Mensagem de render não possui jobId e generation válidos')
  }

  return { jobId: value.jobId, generation: value.generation }
}

export async function createQueue(sqs: SQSClient, name: string): Promise<string> {
  const result = await sqs.send(new CreateQueueCommand({ QueueName: name }))
  if (!result.QueueUrl) throw new Error('SQS não retornou URL para a fila criada')
  return result.QueueUrl
}

export async function deleteQueue(sqs: SQSClient, queueUrl: string): Promise<void> {
  await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }))
}

export async function receiveOne(sqs: SQSClient, queueUrl: string): Promise<Message | undefined> {
  const result = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 1,
      VisibilityTimeout: 60,
    }),
  )
  return result.Messages?.[0]
}

export async function deleteMessage(
  sqs: SQSClient,
  queueUrl: string,
  message: Message,
): Promise<void> {
  if (!message.ReceiptHandle) throw new Error('Mensagem SQS sem ReceiptHandle')
  await sqs.send(
    new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }),
  )
}
