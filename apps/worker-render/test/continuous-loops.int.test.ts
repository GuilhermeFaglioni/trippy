import { randomUUID } from 'node:crypto'
import { CreateQueueCommand, DeleteQueueCommand, SQSClient } from '@aws-sdk/client-sqs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { runDispatcher } from '../src/dispatcher.ts'
import { runReconciler } from '../src/reconciler.ts'
import { createRecap, claimQueuedJob, tryAcquireJobLaunchGuard } from '../src/persistence.ts'
import { createWorkerPool } from '../src/pool.ts'
import type { DispatcherConfig } from '../src/config.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definido: configure o Postgres local')

const testDatabaseName = `trippy_worker_loops_${process.pid}_${randomUUID().replaceAll('-', '')}`
const adminUrl = new URL(databaseUrl)
adminUrl.pathname = '/postgres'
const testUrl = new URL(databaseUrl)
testUrl.pathname = `/${testDatabaseName}`

let databaseCreated = false
let pool: InstanceType<typeof pg.Pool> | undefined
let tripId: string
let queueUrl: string | undefined
const sqsEndpoint = process.env.SQS_ENDPOINT ?? 'http://localhost:59324'
const sqs = new SQSClient({
  endpoint: sqsEndpoint,
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'trippy',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'trippy-dev-secret',
  },
})
const runId = `continuous-${process.pid}-${randomUUID().slice(0, 8)}`

function database(): InstanceType<typeof pg.Pool> {
  if (!pool) throw new Error('Test Postgres ainda não foi inicializado')
  return pool
}

function config(): DispatcherConfig {
  if (!queueUrl) throw new Error('Fila de integração ainda não foi inicializada')
  return {
    databaseUrl: testUrl.toString(),
    sqsEndpoint,
    s3Endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:59000',
    region: process.env.AWS_REGION ?? 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'trippy',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'trippy-dev-secret',
    photosBucket: 'worker-loop-test-photos',
    videosBucket: 'worker-loop-test-videos',
    queueUrl,
    runId,
    renderImage: 'worker-loop-test-image',
    leaseDurationMs: 30_000,
  }
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
  pool = createWorkerPool(testUrl.toString())
  const owner = await pool.query<{ id: string }>(
    "INSERT INTO users (name, email) VALUES ('Worker loop test', 'worker-loop@example.test') RETURNING id",
  )
  const trip = await pool.query<{ id: string }>(
    `INSERT INTO trips (name, destination, start_date, end_date, timezone, organizer_id)
     VALUES ('Viagem de teste', 'Pequim', '2026-09-01', '2026-09-03', 'Asia/Shanghai', $1)
     RETURNING id`,
    [owner.rows[0]!.id],
  )
  tripId = trip.rows[0]!.id

  const queue = await sqs.send(
    new CreateQueueCommand({
      QueueName: `trippy-worker-loops-${process.pid}-${randomUUID().slice(0, 8)}`,
    }),
  )
  queueUrl = queue.QueueUrl
  if (!queueUrl) throw new Error('ElasticMQ não retornou a URL da fila de integração')
})

afterAll(async () => {
  if (queueUrl) await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }))
  sqs.destroy()
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

async function expectLockReleased(key: string): Promise<void> {
  const client = await database().connect()
  try {
    const acquired = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [key],
    )
    expect(acquired.rows[0]!.acquired).toBe(true)
    await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key])
  } finally {
    client.release()
  }
}

async function expectJobGuardReleased(jobId: string): Promise<void> {
  const guard = await tryAcquireJobLaunchGuard(database(), jobId)
  expect(guard).not.toBeNull()
  await guard?.release()
}

async function expectPoolIdle(): Promise<void> {
  expect(database().waitingCount).toBe(0)
  expect(database().idleCount).toBe(database().totalCount)
}

function createLoopRecap(idempotencyKey: string) {
  return createRecap(database(), {
    tripId,
    idempotencyKey,
    createdAt: '2026-09-04T10:00:00.000Z',
    content: { places: [], photos: [] },
  })
}

describe('loops contínuos do worker-render', () => {
  it('registra execução após lançamento, aborta e libera lock e conexões do dispatcher', async () => {
    const recap = await createLoopRecap('dispatcher-continuous-loop')
    const jobResult = await database().query<{ id: string }>(
      `SELECT id FROM render_jobs WHERE recap_id = $1`,
      [recap.recapId],
    )
    const jobIds = jobResult.rows.map(({ id }) => id)
    const controller = new AbortController()
    let launched: { jobId: string; fencingToken: number } | undefined
    const runtime = {
      async launchWorker(input: { jobId: string; fencingToken: number }) {
        launched = input
        controller.abort()
        return 'worker-loop-container'
      },
      async stop() {},
      async remove() {},
    }

    await runDispatcher(database(), sqs, runtime, config(), controller.signal)

    expect(launched?.fencingToken).toBe(1)
    expect(jobIds).toContain(launched?.jobId)
    const stored = await database().query<{ status: string; executionId: string }>(
      `SELECT status, execution_id AS "executionId" FROM render_jobs WHERE id = $1`,
      [launched?.jobId],
    )
    expect(stored.rows[0]).toEqual({ status: 'running', executionId: 'worker-loop-container' })
    await expectLockReleased(`trippy:spike19:${runId}:dispatcher`)
    await expectJobGuardReleased(launched!.jobId)
    await expectPoolIdle()
  }, 15_000)

  it('reconcilia worker ausente no loop contínuo, aborta e libera lock e conexões', async () => {
    const recap = await createLoopRecap('reconciler-continuous-loop')
    const jobResult = await database().query<{ id: string; generation: number }>(
      `SELECT id, generation FROM render_jobs WHERE recap_id = $1 AND variant = 'clean'`,
      [recap.recapId],
    )
    const job = jobResult.rows[0]!
    const claim = await claimQueuedJob(database(), {
      jobId: job.id,
      generation: job.generation,
      leaseDurationMs: 30_000,
    })
    if (!claim.claimed) throw new Error('Job não recebeu lease para o teste contínuo')
    await claim.releaseLaunchGuard()
    await database().query(
      `UPDATE render_jobs SET lease_until = clock_timestamp() - interval '1 second' WHERE id = $1`,
      [job.id],
    )

    const controller = new AbortController()
    const inspected: string[] = []
    const runtime = {
      async inspect(executionId: string) {
        inspected.push(executionId)
        if (executionId === claim.executionId) {
          controller.abort()
          return { id: null, status: 'missing' as const, exitCode: null }
        }
        return { id: executionId, status: 'running' as const, exitCode: null }
      },
      async stop() {},
      async remove() {},
    }

    await runReconciler(database(), sqs, runtime, config(), controller.signal)

    expect(inspected).toContain(claim.executionId)
    const stored = await database().query<{
      status: string
      generation: number
      attempts: number
      fencingToken: string
    }>(
      `SELECT status, generation, attempts, fencing_token AS "fencingToken"
         FROM render_jobs WHERE id = $1`,
      [job.id],
    )
    expect(stored.rows[0]).toEqual({
      status: 'queued',
      generation: 2,
      attempts: 1,
      fencingToken: '1',
    })
    await expectLockReleased(`trippy:spike19:${runId}:reconciler`)
    await expectJobGuardReleased(job.id)
    await expectPoolIdle()
  }, 15_000)
})
