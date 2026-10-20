import { randomUUID } from 'node:crypto'
import {
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { dispatchOne } from '../src/dispatcher.ts'
import { reconcileWorkers } from '../src/reconciler.ts'
import {
  claimQueuedJob,
  completeJob,
  createRecap,
  isJobVideoPublished,
  publishOutboxBatch,
  reconcileExpiredJobs,
} from '../src/persistence.ts'

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
let queueUrl: string | undefined
const sqs = new SQSClient({
  endpoint: process.env.SQS_ENDPOINT ?? 'http://localhost:59324',
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'trippy',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'trippy-dev-secret',
  },
})

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

  const queue = await sqs.send(
    new CreateQueueCommand({
      QueueName: `trippy-spike19-it-${process.pid}-${randomUUID().slice(0, 8)}`,
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

  it('publishes outbox jobs and starts one detached worker for duplicate messages', async () => {
    const recap = await createRecap(database(), {
      tripId,
      idempotencyKey: 'elasticmq-outbox',
      createdAt: '2026-09-04T10:00:00.000Z',
      content: { places: [], photos: [] },
    })

    expect(await publishOutboxBatch(database(), sqs, queueUrl!, 10)).toBe(4)
    expect(await publishOutboxBatch(database(), sqs, queueUrl!, 10)).toBe(0)

    const outboxMessages = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 }),
    )
    expect(outboxMessages.Messages).toHaveLength(4)
    const jobs = await database().query<{ id: string; generation: number }>(
      'SELECT id, generation FROM render_jobs ORDER BY id',
    )
    const expectedMessages = new Set(jobs.rows.map(({ id, generation }) => `${id}:${generation}`))
    const receivedMessages = new Set(
      outboxMessages.Messages!.map(({ Body }) => {
        const body = JSON.parse(Body!) as { jobId: string; generation: number }
        return `${body.jobId}:${body.generation}`
      }),
    )
    expect(receivedMessages).toEqual(expectedMessages)

    for (const message of outboxMessages.Messages ?? []) {
      await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle,
        }),
      )
    }

    const currentRecapJobs = await database().query<{ id: string; generation: number }>(
      'SELECT id, generation FROM render_jobs WHERE recap_id = $1 ORDER BY variant',
      [recap.recapId],
    )
    const duplicateJob = currentRecapJobs.rows[0]!
    const duplicateMessage = JSON.stringify({
      jobId: duplicateJob.id,
      generation: duplicateJob.generation,
    })
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: duplicateMessage }))
    await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: duplicateMessage }))
    let launchCount = 0
    const runtime = {
      async launchWorker() {
        launchCount += 1
        return `fake-container-${launchCount}`
      },
      async stop() {},
      async remove() {},
    }
    const config = {
      databaseUrl: testUrl.toString(),
      sqsEndpoint: process.env.SQS_ENDPOINT ?? 'http://localhost:59324',
      s3Endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:59000',
      region: process.env.AWS_REGION ?? 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'trippy',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'trippy-dev-secret',
      photosBucket: 'spike19-it-photos',
      videosBucket: 'spike19-it-videos',
      queueUrl: queueUrl!,
      runId: 'spike19-integration',
      renderImage: 'spike19-integration-image',
      leaseDurationMs: 30_000,
    }
    const started = await dispatchOne(database(), sqs, runtime, config)
    expect(started).toMatchObject({ kind: 'started', jobId: duplicateJob.id, fencingToken: 1 })
    expect(launchCount).toBe(1)
    expect(await dispatchOne(database(), sqs, runtime, config)).toEqual({ kind: 'busy' })
    expect(launchCount).toBe(1)

    const remainingDuplicate = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 1 }),
    )
    expect(remainingDuplicate.Messages).toHaveLength(1)
    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: remainingDuplicate.Messages![0]!.ReceiptHandle,
      }),
    )
    if (started.kind !== 'started') throw new Error('Dispatcher não iniciou worker desacoplado')

    await database().query(
      `UPDATE render_jobs SET lease_until = clock_timestamp() - interval '1 second' WHERE id = $1`,
      [duplicateJob.id],
    )
    expect(await reconcileExpiredJobs(database(), 10)).toEqual({ requeued: 1, failed: 0 })

    const retried = await claimQueuedJob(database(), {
      jobId: duplicateJob.id,
      generation: duplicateJob.generation + 1,
      leaseDurationMs: 30_000,
    })
    if (!retried.claimed) throw new Error('Segunda geração não pôde receber lease')
    await retried.releaseLaunchGuard()

    expect(
      await completeJob(database(), {
        jobId: duplicateJob.id,
        fencingToken: started.fencingToken,
        videoKey: 'stale-worker.mp4',
        metrics: { renderMilliseconds: 100, cpuMilliseconds: 80, peakMemoryBytes: 1000 },
      }),
    ).toEqual({ completed: false, reason: 'stale-fence' })

    expect(
      await completeJob(database(), {
        jobId: duplicateJob.id,
        fencingToken: retried.job.fencingToken,
        videoKey: 'recaps/test/clean/2.mp4',
        metrics: { renderMilliseconds: 12_345, cpuMilliseconds: 9_876, peakMemoryBytes: 8_000_000 },
      }),
    ).toEqual({ completed: true, recapStatus: 'rendering' })
    expect(
      await isJobVideoPublished(database(), {
        jobId: duplicateJob.id,
        fencingToken: retried.job.fencingToken,
        videoKey: 'recaps/test/clean/2.mp4',
      }),
    ).toBe(true)
    expect(
      await isJobVideoPublished(database(), {
        jobId: duplicateJob.id,
        fencingToken: started.fencingToken,
        videoKey: 'stale-worker.mp4',
      }),
    ).toBe(false)

    const completed = await database().query<{
      status: string
      attempts: number
      fencing_token: string
      video_key: string
      render_milliseconds: string
      cpu_milliseconds: string
      peak_memory_bytes: string
    }>(
      `SELECT status, attempts, fencing_token, video_key, render_milliseconds,
              cpu_milliseconds, peak_memory_bytes
       FROM render_jobs WHERE id = $1`,
      [duplicateJob.id],
    )
    expect(completed.rows[0]).toEqual({
      status: 'succeeded',
      attempts: 2,
      fencing_token: '2',
      video_key: 'recaps/test/clean/2.mp4',
      render_milliseconds: '12345',
      cpu_milliseconds: '9876',
      peak_memory_bytes: '8000000',
    })
  })

  it('marks an interrupted job failed after three attempts', async () => {
    const recap = await createRecap(database(), {
      tripId,
      idempotencyKey: 'attempt-limit',
      createdAt: '2026-09-04T10:00:00.000Z',
      content: { places: [], photos: [] },
    })
    const jobResult = await database().query<{ id: string; generation: number }>(
      `SELECT id, generation FROM render_jobs WHERE recap_id = $1 AND variant = 'clean'`,
      [recap.recapId],
    )
    const job = jobResult.rows[0]!

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claim = await claimQueuedJob(database(), {
        jobId: job.id,
        generation: job.generation + attempt - 1,
        leaseDurationMs: 30_000,
      })
      if (!claim.claimed) throw new Error(`Tentativa ${attempt} não pôde receber lease`)
      await claim.releaseLaunchGuard()
      await database().query(
        `UPDATE render_jobs SET lease_until = clock_timestamp() - interval '1 second' WHERE id = $1`,
        [job.id],
      )
      expect(await reconcileExpiredJobs(database(), 10)).toEqual(
        attempt < 3 ? { requeued: 1, failed: 0 } : { requeued: 0, failed: 1 },
      )
    }

    const terminal = await database().query<{ status: string; attempts: number }>(
      'SELECT status, attempts FROM render_jobs WHERE id = $1',
      [job.id],
    )
    expect(terminal.rows[0]).toEqual({ status: 'failed', attempts: 3 })
  })

  it('holds reconciliation while Docker launch is unregistered and waits for a valid lease', async () => {
    const recap = await createRecap(database(), {
      tripId,
      idempotencyKey: 'launch-race-guard',
      createdAt: '2026-09-04T10:00:00.000Z',
      content: { places: [], photos: [] },
    })
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
    if (!claim.claimed) throw new Error('Job não recebeu lease de lançamento')

    let inspections = 0
    const runtime = {
      async inspect() {
        inspections += 1
        return { id: null, status: 'missing' as const, exitCode: null }
      },
      async stop() {},
      async remove() {},
    }
    expect(await reconcileWorkers(database(), runtime)).toMatchObject({ checked: 1, active: 1 })
    expect(inspections).toBe(0)

    await claim.releaseLaunchGuard()
    expect(await reconcileWorkers(database(), runtime)).toMatchObject({ checked: 1, active: 1 })
    expect(inspections).toBe(1)

    await database().query(
      `UPDATE render_jobs SET lease_until = clock_timestamp() - interval '1 second' WHERE id = $1`,
      [job.id],
    )
    expect(await reconcileWorkers(database(), runtime)).toMatchObject({ checked: 1, requeued: 1 })
    const stored = await database().query<{ status: string; generation: number }>(
      `SELECT status, generation FROM render_jobs WHERE id = $1`,
      [job.id],
    )
    expect(stored.rows[0]).toEqual({ status: 'queued', generation: 2 })
  })
})
