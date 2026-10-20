import { Hono } from 'hono'
import { loadConfig } from './config.ts'
import { createHealthChecks, runHealthChecks, type HealthChecks } from './health.ts'

/** Aplicação Hono; as checagens de dependências são injetáveis para teste. */
export function createApp(
  healthChecks: HealthChecks = createHealthChecks(loadConfig()),
  healthTimeoutMs = 1_000,
) {
  const app = new Hono()
  app.get('/health', async (c) => {
    const result = await runHealthChecks(healthChecks, healthTimeoutMs)
    return c.json(result, result.status === 'ok' ? 200 : 503)
  })
  return app
}
