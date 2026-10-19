import { Hono } from 'hono'

/** App HTTP sem nada de AWS: roda em Node localmente e em Lambda via adaptador (arquitetura.md). */
export function createApp() {
  const app = new Hono()
  app.get('/health', (c) => c.json({ status: 'ok' }))
  return app
}
