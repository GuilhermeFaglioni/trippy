import { serve } from '@hono/node-server'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import { createAuthRouter } from './auth/router.ts'
import { loadConfig } from './config.ts'
import { createHealthChecks, type HealthChecks } from './health.ts'
import { createInvitesRouter } from './invites/router.ts'
import { createSyncRouter } from './sync/router.ts'
import { createTripsRouter } from './trips/router.ts'
import { createPhotosRouter } from './trips/photos-router.ts'

export async function startApiServer(
  config: ReturnType<typeof loadConfig>,
  healthChecks: HealthChecks = createHealthChecks(config),
) {
  const auth = await createAuthRouter(config)
  const trips = createTripsRouter(config, { accessTokenVerifier: auth.verifyAccessToken })
  const sync = createSyncRouter(config, { accessTokenVerifier: auth.verifyAccessToken })
  const invites = createInvitesRouter(config, { accessTokenVerifier: auth.verifyAccessToken })
  const photos = createPhotosRouter(config, { accessTokenVerifier: auth.verifyAccessToken })
  const server = serve(
    {
      fetch: createApp(healthChecks, 1_000, auth.router, trips.router, sync.router, invites.router, photos.router)
        .fetch,
      port: config.port,
      hostname: config.host,
    },
    () => {
      const address = server.address()
      const port = address && typeof address !== 'string' ? address.port : config.port
      console.log(`API em http://${config.host}:${port}`)
    },
  )
  server.once(
    'close',
    () => void Promise.all([auth.close(), trips.close(), sync.close(), invites.close(), photos.close()]),
  )
  return server
}

const currentFile = fileURLToPath(import.meta.url)

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  void startApiServer(loadConfig()).catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
