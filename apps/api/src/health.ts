import { HeadBucketCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3'
import { GetQueueUrlCommand, SQSClient, type SQSClientConfig } from '@aws-sdk/client-sqs'
import pg from 'pg'
import { connect } from 'node:net'
import type { ApiConfig } from './config.ts'

export type HealthService = 'postgres' | 'storage' | 'queue' | 'mail'
export type HealthChecks = Record<HealthService, () => Promise<void>>
export type ServiceHealth = { status: 'ok' } | { status: 'error'; error: string }

export interface HealthResponse {
  status: 'ok' | 'error'
  services: Record<HealthService, ServiceHealth>
}

function credentialsFor(config: ApiConfig) {
  return config.awsAccessKeyId && config.awsSecretAccessKey
    ? { accessKeyId: config.awsAccessKeyId, secretAccessKey: config.awsSecretAccessKey }
    : undefined
}

function s3ClientConfig(config: ApiConfig): S3ClientConfig {
  const credentials = credentialsFor(config)
  return {
    region: config.awsRegion,
    forcePathStyle: config.s3ForcePathStyle,
    ...(config.s3Endpoint ? { endpoint: config.s3Endpoint } : {}),
    ...(credentials ? { credentials } : {}),
  }
}

function sqsClientConfig(config: ApiConfig): SQSClientConfig {
  const credentials = credentialsFor(config)
  return {
    region: config.awsRegion,
    ...(config.sqsEndpoint ? { endpoint: config.sqsEndpoint } : {}),
    ...(credentials ? { credentials } : {}),
  }
}

function checkMail(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port })
    let greeting = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(new Error(`Conexão SMTP excedeu ${timeoutMs} ms.`))
    }, timeoutMs)

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) {
        socket.destroy()
        reject(error)
      } else {
        socket.end()
        resolve()
      }
    }

    socket.on('error', (error) => finish(error))
    socket.on('data', (chunk: Buffer) => {
      greeting += chunk.toString('utf8')
      const lines = greeting.split(/\r?\n/)
      const firstLine = lines[0]
      if (lines.some((line) => line.startsWith('220 '))) {
        finish()
      } else if (firstLine && !firstLine.startsWith('220-')) {
        finish(new Error(`Banner SMTP inválido: ${firstLine}`))
      }
    })
  })
}

export function createHealthChecks(config: ApiConfig, timeoutMs = 1_000): HealthChecks {
  return {
    postgres: async () => {
      const client = new pg.Client({
        connectionString: config.databaseUrl,
        connectionTimeoutMillis: timeoutMs,
        query_timeout: timeoutMs,
      })
      try {
        await client.connect()
        await client.query('select 1')
      } finally {
        await client.end().catch(() => {})
      }
    },
    storage: async () => {
      const client = new S3Client(s3ClientConfig(config))
      try {
        await client.send(new HeadBucketCommand({ Bucket: config.s3BucketPhotos }), {
          abortSignal: AbortSignal.timeout(timeoutMs),
        })
      } finally {
        client.destroy()
      }
    },
    queue: async () => {
      const client = new SQSClient(sqsClientConfig(config))
      try {
        await client.send(new GetQueueUrlCommand({ QueueName: config.sqsQueueThumbs }), {
          abortSignal: AbortSignal.timeout(timeoutMs),
        })
      } finally {
        client.destroy()
      }
    },
    mail: () => checkMail(config.smtpHost, config.smtpPort, timeoutMs),
  }
}

export async function runHealthChecks(
  checks: HealthChecks,
  timeoutMs = 1_000,
): Promise<HealthResponse> {
  const entries = await Promise.all(
    (Object.keys(checks) as HealthService[]).map(async (service) => {
      let timeout: NodeJS.Timeout | undefined
      try {
        await Promise.race([
          checks[service](),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error(`Tempo esgotado após ${timeoutMs} ms.`)),
              timeoutMs,
            )
          }),
        ])
        return [service, { status: 'ok' }] as const
      } catch (error) {
        return [
          service,
          { status: 'error', error: error instanceof Error ? error.message : String(error) },
        ] as const
      } finally {
        if (timeout) clearTimeout(timeout)
      }
    }),
  )
  const services = Object.fromEntries(entries) as Record<HealthService, ServiceHealth>
  const status = Object.values(services).every((service) => service.status === 'ok')
    ? 'ok'
    : 'error'
  return { status, services }
}
