import pg from 'pg'
import { expect, it } from 'vitest'

const url = process.env.DATABASE_URL
if (!url)
  throw new Error('DATABASE_URL não definido: suba o Postgres com `docker compose up -d postgres`')

it('conecta no Postgres', async () => {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const { rows } = await client.query<{ ok: number }>('select 1 as ok')
    expect(rows[0]?.ok).toBe(1)
  } finally {
    await client.end()
  }
})
