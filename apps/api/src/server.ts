import { serve } from '@hono/node-server'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { createHealthChecks, type HealthChecks } from './health.ts'

export function startApiServer(
  config: ReturnType<typeof loadConfig>,
  healthChecks: HealthChecks = createHealthChecks(config),
) {
  const server = serve(
    { fetch: createApp(healthChecks).fetch, port: config.port, hostname: config.host },
    () => {
      const address = server.address()
      const port = address && typeof address !== 'string' ? address.port : config.port
      console.log(`API em http://${config.host}:${port}`)
    },
  )
  return server
}

const currentFile = fileURLToPath(import.meta.url)

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  startApiServer(loadConfig())
}
