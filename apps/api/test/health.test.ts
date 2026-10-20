import { createServer } from 'node:net'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { createHealthChecks, type HealthChecks } from '../src/health.ts'
import type { ApiConfig } from '../src/config.ts'

function healthyChecks(): HealthChecks {
  return {
    postgres: async () => {},
    storage: async () => {},
    queue: async () => {},
    mail: async () => {},
  }
}

it('GET /health responde 200 quando todos os serviços estão saudáveis', async () => {
  const res = await createApp(healthyChecks()).request('/health')

  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    status: 'ok',
    services: {
      postgres: { status: 'ok' },
      storage: { status: 'ok' },
      queue: { status: 'ok' },
      mail: { status: 'ok' },
    },
  })
})

it('GET /health responde 503 e identifica somente o serviço com falha', async () => {
  const checks = healthyChecks()
  checks.storage = async () => {
    throw new Error('bucket indisponível')
  }

  const res = await createApp(checks).request('/health')

  expect(res.status).toBe(503)
  expect(await res.json()).toEqual({
    status: 'error',
    services: {
      postgres: { status: 'ok' },
      storage: { status: 'error', error: 'bucket indisponível' },
      queue: { status: 'ok' },
      mail: { status: 'ok' },
    },
  })
})

it('GET /health transforma timeout em erro do serviço', async () => {
  const checks = healthyChecks()
  checks.queue = () => new Promise(() => {})

  const res = await createApp(checks, 10).request('/health')

  expect(res.status).toBe(503)
  expect(await res.json()).toMatchObject({
    status: 'error',
    services: {
      queue: { status: 'error', error: 'Tempo esgotado após 10 ms.' },
    },
  })
})

it('aceita banner SMTP fragmentado somente quando recebe CRLF', async () => {
  const smtp = createServer((socket) => {
    socket.setNoDelay(true)
    const send = (chunk: string) => {
      if (!socket.destroyed) socket.write(chunk)
    }
    send('2')
    setTimeout(() => send('20 Mailpit ESMTP\r'), 10)
    setTimeout(() => send('\n'), 20)
  })
  smtp.listen(0, '127.0.0.1')
  await once(smtp, 'listening')
  const address = smtp.address() as AddressInfo
  const config: ApiConfig = {
    port: 3000,
    host: '127.0.0.1',
    appEnv: 'development',
    authMode: 'dev',
    authIssuer: 'trippy-dev-auth',
    authAudience: 'trippy-dev',
    databaseUrl: 'postgres://trippy:trippy@localhost:54329/trippy',
    awsRegion: 'us-east-1',
    s3ForcePathStyle: false,
    s3BucketPhotos: 'trippy-photos',
    sqsQueueThumbs: 'trippy-thumbs',
    smtpHost: '127.0.0.1',
    smtpPort: address.port,
  }

  try {
    await expect(createHealthChecks(config).mail()).resolves.toBeUndefined()
  } finally {
    await new Promise<void>((resolve, reject) => {
      smtp.close((error) => (error ? reject(error) : resolve()))
    })
  }
})
