import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { createHealthChecks } from './health.ts'

const config = loadConfig()
serve({ fetch: createApp(createHealthChecks(config)).fetch, port: config.port }, () =>
  console.log(`API em http://localhost:${config.port}`),
)
