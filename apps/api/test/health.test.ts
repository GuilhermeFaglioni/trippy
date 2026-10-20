import { expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import type { HealthChecks } from '../src/health.ts'

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
