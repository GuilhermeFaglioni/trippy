import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { startApiServer } from '../src/server.ts'
import type { HealthChecks } from '../src/health.ts'

const environment: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://trippy:trippy@localhost:54329/trippy',
  S3_BUCKET_PHOTOS: 'trippy-photos',
  SQS_QUEUE_THUMBS: 'trippy-thumbs',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '51025',
}

const healthyChecks: HealthChecks = {
  postgres: async () => {},
  storage: async () => {},
  queue: async () => {},
  mail: async () => {},
}

it('escuta em 127.0.0.1 por padrão', async () => {
  const config = loadConfig(environment)
  const server = startApiServer({ ...config, port: 0 }, healthyChecks)

  try {
    await once(server, 'listening')
    const address = server.address() as AddressInfo

    expect(address).toMatchObject({ address: '127.0.0.1', family: 'IPv4' })
    const response = await fetch(`http://127.0.0.1:${address.port}/health`)
    expect(response.status).toBe(200)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})
