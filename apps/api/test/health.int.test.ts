import { expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { createHealthChecks, type HealthResponse } from '../src/health.ts'

const config = loadConfig()

it('GET /health verifica Postgres, storage, fila e SMTP locais', async () => {
  const res = await createApp(createHealthChecks(config)).request('/health')

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

it('GET /health limita erro de storage ao serviço com endpoint indisponível', async () => {
  const res = await createApp(
    createHealthChecks({ ...config, s3Endpoint: 'http://127.0.0.1:1' }),
  ).request('/health')
  const body = (await res.json()) as HealthResponse

  expect(res.status).toBe(503)
  expect(body.status).toBe('error')
  expect(body.services.postgres.status).toBe('ok')
  expect(body.services.storage.status).toBe('error')
  expect(body.services.storage).toMatchObject({ status: 'error' })
  expect('error' in body.services.storage && body.services.storage.error).toBeTruthy()
  expect(body.services.queue.status).toBe('ok')
  expect(body.services.mail.status).toBe('ok')
})
