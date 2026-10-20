import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { createRecap } from '../src/persistence.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')

const testDatabaseName = `trippy_recap_spike_${process.pid}_${randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testUrl = new URL(databaseUrl)
testUrl.pathname = `/${testDatabaseName}`

let databaseCreated = false
let pool: InstanceType<typeof pg.Pool> | undefined
let tripId: string

function database(): InstanceType<typeof pg.Pool> {
  if (!pool) throw new Error('Test Postgres ainda não foi inicializado')
  return pool
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${testDatabaseName}"`)
    databaseCreated = true
  } finally {
    await admin.end()
  }

  await migrate({ databaseUrl: testUrl.toString() })
  pool = new pg.Pool({ connectionString: testUrl.toString() })
  const owner = await pool.query<{ id: string }>(
    "INSERT INTO users (name, email) VALUES ('Spike 19', 'spike19@example.test') RETURNING id",
  )
  const trip = await pool.query<{ id: string }>(
    `INSERT INTO trips (name, destination, start_date, end_date, timezone, organizer_id)
     VALUES ('Viagem de teste', 'Pequim', '2026-09-01', '2026-09-03', 'Asia/Shanghai', $1)
     RETURNING id`,
    [owner.rows[0]!.id],
  )
  tripId = trip.rows[0]!.id
})

afterAll(async () => {
  await pool?.end()
  if (!databaseCreated) return

  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE "${testDatabaseName}"`)
  } finally {
    await admin.end()
  }
})

describe('createRecap', () => {
  it('commits one immutable snapshot, two variant jobs, and their outbox rows atomically', async () => {
    const input = {
      tripId,
      idempotencyKey: 'trip-ended-2026-09-03',
      createdAt: '2026-09-04T10:00:00.000Z',
      content: {
        places: [
          {
            id: 'place-1',
            name: 'Templo do Céu',
            localName: '天坛',
            address: 'Beijing',
            dayIndex: 0,
            position: 0,
            visits: 1,
            favorites: 1,
          },
        ],
        photos: [],
      },
    }

    const results = await Promise.all([
      createRecap(database(), input),
      createRecap(database(), input),
    ])
    expect(results.map(({ version }) => version)).toEqual([1, 1])
    expect(new Set(results.map(({ recapId }) => recapId)).size).toBe(1)
    expect(results.filter(({ reused }) => !reused)).toHaveLength(1)

    const recap = await database().query<{ snapshot: Record<string, unknown>; status: string }>(
      'SELECT snapshot, status FROM recaps WHERE id = $1',
      [results[0]!.recapId],
    )
    expect(recap.rows[0]).toMatchObject({
      status: 'queued',
      snapshot: {
        schemaVersion: 1,
        trip: { id: tripId, destination: 'Pequim', timezone: 'Asia/Shanghai' },
        stats: { placeCount: 1, photoCount: 0 },
      },
    })
    expect(recap.rows[0]!.snapshot).not.toHaveProperty('googleDetails')

    const counts = await database().query<{ jobs: string; outbox: string }>(
      `SELECT
         (SELECT count(*) FROM render_jobs WHERE recap_id = $1) AS jobs,
         (SELECT count(*) FROM render_outbox WHERE job_id IN (
           SELECT id FROM render_jobs WHERE recap_id = $1
         )) AS outbox`,
      [results[0]!.recapId],
    )
    expect(counts.rows[0]).toEqual({ jobs: '2', outbox: '2' })

    await expect(
      database().query('UPDATE recaps SET snapshot = snapshot || $2::jsonb WHERE id = $1', [
        results[0]!.recapId,
        JSON.stringify({ changed: true }),
      ]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('rolls back recap and outbox rows when inserting a variant job fails', async () => {
    await database().query(`
      CREATE FUNCTION reject_spike19_render_job() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'injected render job failure';
      END;
      $$
    `)
    await database().query(`
      CREATE TRIGGER reject_spike19_render_job_trigger
      BEFORE INSERT ON render_jobs FOR EACH ROW EXECUTE FUNCTION reject_spike19_render_job()
    `)

    try {
      await expect(
        createRecap(database(), {
          tripId,
          idempotencyKey: 'rollback-probe',
          createdAt: '2026-09-04T10:00:00.000Z',
          content: { places: [], photos: [] },
        }),
      ).rejects.toThrow('injected render job failure')

      const leftovers = await database().query<{ count: string }>(
        `SELECT count(*) FROM recaps WHERE idempotency_key = 'rollback-probe'`,
      )
      expect(leftovers.rows[0]!.count).toBe('0')
    } finally {
      await database().query('DROP TRIGGER reject_spike19_render_job_trigger ON render_jobs')
      await database().query('DROP FUNCTION reject_spike19_render_job()')
    }
  })
})
