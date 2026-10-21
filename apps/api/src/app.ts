import { Hono } from 'hono'
import { handleApiError } from './auth/errors.ts'
import { loadConfig } from './config.ts'
import { createHealthChecks, runHealthChecks, type HealthChecks } from './health.ts'
import type { AuthEnvironment } from './auth/authenticate.ts'

/** Aplicação Hono; as checagens de dependências são injetáveis para teste. */
export function createApp(
  healthChecks: HealthChecks = createHealthChecks(loadConfig()),
  healthTimeoutMs = 1_000,
  authRouter?: Hono<AuthEnvironment>,
  tripsRouter?: Hono<AuthEnvironment>,
) {
  const app = new Hono<AuthEnvironment>()
  if (authRouter) app.route('/', authRouter)
  if (tripsRouter) app.route('/', tripsRouter)
  app.get('/health', async (c) => {
    const result = await runHealthChecks(healthChecks, healthTimeoutMs)
    return c.json(result, result.status === 'ok' ? 200 : 503)
  })
  app.notFound((c) => c.json({ error: 'not_found', message: 'Rota não encontrada.' }, 404))
  app.onError(handleApiError)
  return app
}
