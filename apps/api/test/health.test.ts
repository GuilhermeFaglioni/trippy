import { expect, it } from 'vitest'
import { createApp } from '../src/app.ts'

it('GET /health responde ok', async () => {
  const res = await createApp().request('/health')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ status: 'ok' })
})
