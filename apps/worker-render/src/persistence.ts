import {
  buildRecapSnapshot,
  claimRenderJob as claimRenderJobState,
  completeRenderJob as completeRenderJobState,
  reconcileRenderJob as reconcileRenderJobState,
  type RecapSnapshot,
  type RecapPlaceInput,
  type RecapPhotoInput,
  type RenderJob,
} from '@trippy/domain'
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs'
import pg, { type PoolClient } from 'pg'

type Pool = InstanceType<typeof pg.Pool>

const renderVariants = ['clean', 'watermarked'] as const

type CreateRecapInput = Readonly<{
  tripId: string
  idempotencyKey: string
  createdAt?: string
  content: Readonly<{
    places: readonly RecapPlaceInput[]
    photos: readonly RecapPhotoInput[]
  }>
}>

export type CreateRecapResult = Readonly<{
  recapId: string
  version: number
  reused: boolean
}>

type TripRow = {
  id: string
  name: string | null
  destination: string | null
  timezone: string
  startDate: string | null
  endDate: string | null
}

type RenderJobRow = {
  id: string
  recapId: string
  variant: RenderJob['variant']
  status: RenderJob['status']
  generation: number
  attempts: number
  maxAttempts: number
  fencingToken: string
  leaseExpiresAt: Date | null
  executionId: string | null
  videoKey: string | null
}

function toRenderJob(row: RenderJobRow): RenderJob & { maxAttempts: number } {
  return {
    id: row.id,
    recapId: row.recapId,
    variant: row.variant,
    status: row.status,
    generation: row.generation,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    fencingToken: Number(row.fencingToken),
    leaseExpiresAt: row.leaseExpiresAt?.getTime() ?? null,
    executionId: row.executionId,
    videoKey: row.videoKey,
  }
}

const renderJobSelect = `SELECT id, recap_id AS "recapId", variant, status, generation,
                                attempts, max_attempts AS "maxAttempts",
                                fencing_token AS "fencingToken", lease_until AS "leaseExpiresAt",
                                execution_id AS "executionId", video_key AS "videoKey"
                         FROM render_jobs`

export type ClaimQueuedJobResult =
  | {
      claimed: true
      job: RenderJob
      executionId: string
      releaseLaunchGuard: () => Promise<void>
    }
  | {
      claimed: false
      reason: 'not-found' | 'stale-generation' | 'not-queued' | 'invalid-lease'
    }

export async function claimQueuedJob(
  pool: Pool,
  input: Readonly<{ jobId: string; generation: number; leaseDurationMs: number }>,
): Promise<ClaimQueuedJobResult> {
  const client = await pool.connect()
  const lockKey = jobLaunchLockKey(input.jobId)
  let guardAcquired = false
  let keepClient = false
  let transactionOpen = false
  try {
    // Take the same session lock used by reconciliation before exposing a running claim.
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockKey])
    guardAcquired = true
    await client.query('BEGIN')
    transactionOpen = true
    const selected = await client.query<RenderJobRow>(
      `${renderJobSelect} WHERE id = $1 FOR UPDATE`,
      [input.jobId],
    )
    const row = selected.rows[0]
    if (!row) {
      await client.query('COMMIT')
      transactionOpen = false
      return { claimed: false, reason: 'not-found' }
    }

    const clock = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')
    const state = toRenderJob(row)
    const claimed = claimRenderJobState(
      state,
      input.generation,
      clock.rows[0]!.now.getTime(),
      input.leaseDurationMs,
    )
    if (!claimed.claimed) {
      await client.query('COMMIT')
      transactionOpen = false
      return claimed
    }

    const executionId = `trippy-render-${row.id.replaceAll('-', '').slice(0, 12)}-${claimed.job.fencingToken}`
    await client.query(
      `UPDATE render_jobs
       SET status = 'running', attempts = $2, fencing_token = $3,
           lease_until = to_timestamp($4::double precision / 1000.0), execution_id = $5,
           started_at = clock_timestamp(), finished_at = NULL, last_error = NULL,
           video_key = NULL, render_milliseconds = NULL, cpu_milliseconds = NULL,
           peak_memory_bytes = NULL
       WHERE id = $1`,
      [
        row.id,
        claimed.job.attempts,
        claimed.job.fencingToken,
        claimed.job.leaseExpiresAt,
        executionId,
      ],
    )
    await client.query("UPDATE recaps SET status = 'rendering', finished_at = NULL WHERE id = $1", [
      row.recapId,
    ])
    await client.query('COMMIT')
    transactionOpen = false
    keepClient = true
    let released = false
    return {
      claimed: true,
      job: claimed.job,
      executionId,
      releaseLaunchGuard: async () => {
        if (released) return
        released = true
        try {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey])
        } finally {
          client.release()
        }
      },
    }
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK')
    throw error
  } finally {
    if (!keepClient) {
      try {
        if (guardAcquired) {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey])
        }
      } finally {
        client.release()
      }
    }
  }
}

export type JobLaunchGuard = Readonly<{ release: () => Promise<void> }>

export async function tryAcquireJobLaunchGuard(
  pool: Pool,
  jobId: string,
): Promise<JobLaunchGuard | null> {
  const client = await pool.connect()
  const lockKey = jobLaunchLockKey(jobId)
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [lockKey],
    )
    if (!result.rows[0]!.acquired) {
      client.release()
      return null
    }

    let released = false
    return {
      release: async () => {
        if (released) return
        released = true
        try {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey])
        } finally {
          client.release()
        }
      },
    }
  } catch (error) {
    client.release()
    throw error
  }
}

function jobLaunchLockKey(jobId: string): string {
  return `trippy:spike19:job-launch:${jobId}`
}

export async function registerJobExecution(
  pool: Pool,
  input: Readonly<{ jobId: string; fencingToken: number; executionId: string }>,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE render_jobs SET execution_id = $3
     WHERE id = $1 AND status = 'running' AND fencing_token = $2
       AND lease_until > clock_timestamp()`,
    [input.jobId, input.fencingToken, input.executionId],
  )
  return result.rowCount === 1
}

export async function publishOutboxBatch(
  pool: Pool,
  sqs: SQSClient,
  queueUrl: string,
  limit = 10,
): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('O limite da publicação da outbox deve ficar entre 1 e 100')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{ id: string; payload: Record<string, unknown> }>(
      `SELECT id, payload FROM render_outbox
       WHERE published_at IS NULL
       ORDER BY created_at, id
       LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    )

    for (const row of result.rows) {
      await sqs.send(
        new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(row.payload) }),
      )
      await client.query(
        'UPDATE render_outbox SET published_at = clock_timestamp() WHERE id = $1',
        [row.id],
      )
    }

    await client.query('COMMIT')
    return result.rows.length
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export type RenderMetrics = Readonly<{
  renderMilliseconds: number
  cpuMilliseconds: number
  peakMemoryBytes: number
}>

export type RenderJobInput = Readonly<{
  recapId: string
  version: number
  variant: RenderJob['variant']
  snapshot: RecapSnapshot
}>

export async function getJobRenderInput(
  pool: Pool,
  input: Readonly<{ jobId: string; fencingToken: number }>,
): Promise<RenderJobInput | null> {
  const result = await pool.query<RenderJobInput>(
    `SELECT r.id AS "recapId", r.version, j.variant, r.snapshot
     FROM render_jobs j JOIN recaps r ON r.id = j.recap_id
     WHERE j.id = $1 AND j.status = 'running' AND j.fencing_token = $2
       AND j.lease_until > clock_timestamp()`,
    [input.jobId, input.fencingToken],
  )
  return result.rows[0] ?? null
}

async function updateRecapStatus(client: PoolClient, recapId: string): Promise<void> {
  const summary = await client.query<{
    hasFailed: boolean | null
    allSucceeded: boolean | null
    hasRunningOrSucceeded: boolean | null
  }>(
    `SELECT bool_or(status = 'failed') AS "hasFailed",
            bool_and(status = 'succeeded') AS "allSucceeded",
            bool_or(status IN ('running', 'succeeded')) AS "hasRunningOrSucceeded"
     FROM render_jobs WHERE recap_id = $1`,
    [recapId],
  )
  const recapStatus = summary.rows[0]!.hasFailed
    ? 'failed'
    : summary.rows[0]!.allSucceeded
      ? 'ready'
      : summary.rows[0]!.hasRunningOrSucceeded
        ? 'rendering'
        : 'queued'
  await client.query(
    `UPDATE recaps SET status = $2,
                       finished_at = CASE WHEN $2 IN ('ready', 'failed')
                         THEN clock_timestamp() ELSE NULL END
     WHERE id = $1`,
    [recapId, recapStatus],
  )
}

export type CompleteJobResult =
  | { completed: true; recapStatus: 'rendering' | 'ready' | 'failed' }
  | {
      completed: false
      reason: 'not-found' | 'not-running' | 'stale-fence' | 'lease-expired'
    }

export async function completeJob(
  pool: Pool,
  input: Readonly<{
    jobId: string
    fencingToken: number
    videoKey: string
    metrics: RenderMetrics
  }>,
): Promise<CompleteJobResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const selected = await client.query<RenderJobRow>(
      `${renderJobSelect} WHERE id = $1 FOR UPDATE`,
      [input.jobId],
    )
    const row = selected.rows[0]
    if (!row) {
      await client.query('COMMIT')
      return { completed: false, reason: 'not-found' }
    }

    const clock = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')
    const transition = completeRenderJobState(
      toRenderJob(row),
      input.fencingToken,
      clock.rows[0]!.now.getTime(),
      input.videoKey,
    )
    if (!transition.completed) {
      await client.query('COMMIT')
      return transition
    }

    const updated = await client.query(
      `UPDATE render_jobs
       SET status = 'succeeded', lease_until = NULL, execution_id = NULL,
           finished_at = clock_timestamp(),
           video_key = $3, render_milliseconds = $4, cpu_milliseconds = $5,
           peak_memory_bytes = $6
       WHERE id = $1 AND fencing_token = $2 AND status = 'running'
         AND lease_until > clock_timestamp()`,
      [
        input.jobId,
        input.fencingToken,
        input.videoKey,
        input.metrics.renderMilliseconds,
        input.metrics.cpuMilliseconds,
        input.metrics.peakMemoryBytes,
      ],
    )
    if (updated.rowCount !== 1) {
      await client.query('COMMIT')
      return { completed: false, reason: 'lease-expired' }
    }
    await client.query(
      `UPDATE recaps
       SET video_keys = video_keys || jsonb_build_object($2::text, $3::text)
       WHERE id = $1`,
      [row.recapId, row.variant, input.videoKey],
    )
    const summary = await client.query<{ hasFailed: boolean; allSucceeded: boolean }>(
      `SELECT bool_or(status = 'failed') AS "hasFailed",
              bool_and(status = 'succeeded') AS "allSucceeded"
       FROM render_jobs WHERE recap_id = $1`,
      [row.recapId],
    )
    const recapStatus = summary.rows[0]!.hasFailed
      ? 'failed'
      : summary.rows[0]!.allSucceeded
        ? 'ready'
        : 'rendering'
    await client.query(
      `UPDATE recaps SET status = $2,
                         finished_at = CASE WHEN $2 IN ('ready', 'failed')
                           THEN clock_timestamp() ELSE NULL END
       WHERE id = $1`,
      [row.recapId, recapStatus],
    )
    await client.query('COMMIT')
    return { completed: true, recapStatus }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function isJobVideoPublished(
  pool: Pool,
  input: Readonly<{ jobId: string; fencingToken: number; videoKey: string }>,
): Promise<boolean> {
  const result = await pool.query<{ published: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM render_jobs
       WHERE id = $1 AND fencing_token = $2 AND status = 'succeeded' AND video_key = $3
     ) AS published`,
    [input.jobId, input.fencingToken, input.videoKey],
  )
  return result.rows[0]!.published
}

export async function reconcileExpiredJobs(
  pool: Pool,
  limit: number,
): Promise<Readonly<{ requeued: number; failed: number }>> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('O limite de reconciliação deve ficar entre 1 e 100')
  }

  const candidates = await pool.query<{ id: string }>(
    `SELECT id FROM render_jobs
     WHERE status = 'running' AND lease_until <= clock_timestamp()
     ORDER BY lease_until, id LIMIT $1`,
    [limit],
  )
  let requeued = 0
  let failed = 0

  for (const candidate of candidates.rows) {
    const guard = await tryAcquireJobLaunchGuard(pool, candidate.id)
    if (!guard) continue
    let client: PoolClient | undefined
    try {
      client = await pool.connect()
      await client.query('BEGIN')
      const selected = await client.query<RenderJobRow>(
        `${renderJobSelect} WHERE id = $1 FOR UPDATE`,
        [candidate.id],
      )
      const row = selected.rows[0]
      if (!row || row.status !== 'running') {
        await client.query('COMMIT')
        continue
      }

      const clock = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')
      const job = toRenderJob(row)
      const transition = reconcileRenderJobState(
        job,
        clock.rows[0]!.now.getTime(),
        false,
        row.maxAttempts,
      )
      if (!transition.reconciled) {
        await client.query('COMMIT')
        continue
      }

      if (transition.job.status === 'queued') {
        await client.query(
          `UPDATE render_jobs
           SET status = 'queued', generation = $2, lease_until = NULL, execution_id = NULL,
               last_error = 'Lease expirado antes da conclusão'
           WHERE id = $1`,
          [row.id, transition.job.generation],
        )
        await client.query(
          `INSERT INTO render_outbox (job_id, generation, payload)
           VALUES ($1, $2, $3::jsonb)`,
          [
            row.id,
            transition.job.generation,
            JSON.stringify({ jobId: row.id, generation: transition.job.generation }),
          ],
        )
        await updateRecapStatus(client, row.recapId)
        requeued += 1
      } else {
        await client.query(
          `UPDATE render_jobs
           SET status = 'failed', lease_until = NULL, execution_id = NULL,
               last_error = 'Limite de tentativas de render excedido',
               finished_at = clock_timestamp()
           WHERE id = $1`,
          [row.id],
        )
        await updateRecapStatus(client, row.recapId)
        failed += 1
      }
      await client.query('COMMIT')
    } catch (error) {
      if (client) await client.query('ROLLBACK')
      throw error
    } finally {
      client?.release()
      await guard.release()
    }
  }

  return { requeued, failed }
}

export async function renewJobLease(
  pool: Pool,
  input: Readonly<{ jobId: string; fencingToken: number; leaseDurationMs: number }>,
): Promise<boolean> {
  if (!Number.isInteger(input.leaseDurationMs) || input.leaseDurationMs < 30_000) {
    throw new Error('A renovação do lease deve ser de pelo menos 30000 ms')
  }
  const result = await pool.query(
    `UPDATE render_jobs
     SET lease_until = clock_timestamp() + ($3::double precision * interval '1 millisecond')
     WHERE id = $1 AND status = 'running' AND fencing_token = $2
       AND lease_until > clock_timestamp()`,
    [input.jobId, input.fencingToken, input.leaseDurationMs],
  )
  return result.rowCount === 1
}

export type RunningJob = Readonly<{
  id: string
  fencingToken: number
  executionId: string
  leaseExpiresAt: Date
  leaseExpired: boolean
}>

export async function getRunningJob(pool: Pool, jobId: string): Promise<RunningJob | null> {
  const result = await pool.query<{
    id: string
    fencingToken: string
    executionId: string
    leaseExpiresAt: Date
    leaseExpired: boolean
  }>(
    `SELECT id, fencing_token AS "fencingToken", execution_id AS "executionId",
            lease_until AS "leaseExpiresAt", lease_until <= clock_timestamp() AS "leaseExpired"
     FROM render_jobs WHERE status = 'running' AND id = $1`,
    [jobId],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    id: row.id,
    fencingToken: Number(row.fencingToken),
    executionId: row.executionId,
    leaseExpiresAt: row.leaseExpiresAt,
    leaseExpired: row.leaseExpired,
  }
}

export async function listRunningJobs(pool: Pool, limit: number): Promise<readonly RunningJob[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('O limite de leitura dos workers deve ficar entre 1 e 100')
  }
  const result = await pool.query<{
    id: string
    fencingToken: string
    executionId: string
    leaseExpiresAt: Date
    leaseExpired: boolean
  }>(
    `SELECT id, fencing_token AS "fencingToken", execution_id AS "executionId",
            lease_until AS "leaseExpiresAt", lease_until <= clock_timestamp() AS "leaseExpired"
     FROM render_jobs WHERE status = 'running'
     ORDER BY lease_until, id LIMIT $1`,
    [limit],
  )
  return result.rows.map((row) => ({
    id: row.id,
    fencingToken: Number(row.fencingToken),
    executionId: row.executionId,
    leaseExpiresAt: row.leaseExpiresAt,
    leaseExpired: row.leaseExpired,
  }))
}

export type InterruptedJobResult =
  | { status: 'requeued'; generation: number }
  | { status: 'failed' }
  | { status: 'not-running' | 'stale-fence' | 'not-found' }

export async function reconcileInterruptedJob(
  pool: Pool,
  input: Readonly<{ jobId: string; fencingToken: number; reason: string }>,
): Promise<InterruptedJobResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const selected = await client.query<RenderJobRow>(
      `${renderJobSelect} WHERE id = $1 FOR UPDATE`,
      [input.jobId],
    )
    const row = selected.rows[0]
    if (!row) {
      await client.query('COMMIT')
      return { status: 'not-found' }
    }
    if (Number(row.fencingToken) !== input.fencingToken) {
      await client.query('COMMIT')
      return { status: 'stale-fence' }
    }
    if (row.status !== 'running') {
      await client.query('COMMIT')
      return { status: 'not-running' }
    }

    const clock = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')
    const transition = reconcileRenderJobState(
      toRenderJob(row),
      clock.rows[0]!.now.getTime(),
      true,
      row.maxAttempts,
    )
    if (!transition.reconciled) {
      await client.query('COMMIT')
      return { status: 'not-running' }
    }

    const reason = input.reason.slice(0, 2048)
    if (transition.job.status === 'queued') {
      await client.query(
        `UPDATE render_jobs
         SET status = 'queued', generation = $2, lease_until = NULL, execution_id = NULL,
             last_error = $3
         WHERE id = $1`,
        [row.id, transition.job.generation, reason],
      )
      await client.query(
        `INSERT INTO render_outbox (job_id, generation, payload)
         VALUES ($1, $2, $3::jsonb)`,
        [
          row.id,
          transition.job.generation,
          JSON.stringify({ jobId: row.id, generation: transition.job.generation }),
        ],
      )
      await updateRecapStatus(client, row.recapId)
      await client.query('COMMIT')
      return { status: 'requeued', generation: transition.job.generation }
    }

    await client.query(
      `UPDATE render_jobs
       SET status = 'failed', lease_until = NULL, execution_id = NULL,
           last_error = $2, finished_at = clock_timestamp()
       WHERE id = $1`,
      [row.id, reason],
    )
    await updateRecapStatus(client, row.recapId)
    await client.query('COMMIT')
    return { status: 'failed' }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function createRecap(pool: Pool, input: CreateRecapInput): Promise<CreateRecapResult> {
  if (input.idempotencyKey.trim().length === 0) {
    throw new Error('A chave de idempotência do recap não pode ser vazia')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const tripResult = await client.query<TripRow>(
      `SELECT id, name, destination, timezone,
              start_date::text AS "startDate", end_date::text AS "endDate"
       FROM trips WHERE id = $1 FOR UPDATE`,
      [input.tripId],
    )
    const trip = tripResult.rows[0]
    if (!trip) throw new Error(`Viagem não encontrada: ${input.tripId}`)
    if (!trip.startDate || !trip.endDate) {
      throw new Error(`Viagem sem datas completas: ${input.tripId}`)
    }

    const existing = await client.query<{ id: string; version: number }>(
      `SELECT id, version FROM recaps WHERE trip_id = $1 AND idempotency_key = $2`,
      [input.tripId, input.idempotencyKey],
    )
    if (existing.rows[0]) {
      await client.query('COMMIT')
      return {
        recapId: existing.rows[0].id,
        version: existing.rows[0].version,
        reused: true,
      }
    }

    const versionResult = await client.query<{ version: number }>(
      'SELECT COALESCE(max(version), 0) + 1 AS version FROM recaps WHERE trip_id = $1',
      [input.tripId],
    )
    const version = versionResult.rows[0]!.version
    const createdAt = input.createdAt ?? new Date().toISOString()
    const snapshot = buildRecapSnapshot({
      trip: {
        id: trip.id,
        name: trip.name ?? 'Viagem em grupo',
        destination: trip.destination ?? 'Destino não informado',
        timezone: trip.timezone,
        startDate: trip.startDate,
        endDate: trip.endDate,
      },
      createdAt,
      places: input.content.places,
      photos: input.content.photos,
    })

    const recapResult = await client.query<{ id: string }>(
      `INSERT INTO recaps (trip_id, version, idempotency_key, snapshot, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
       RETURNING id`,
      [input.tripId, version, input.idempotencyKey, JSON.stringify(snapshot), createdAt],
    )
    const recapId = recapResult.rows[0]!.id

    for (const variant of renderVariants) {
      const jobResult = await client.query<{ id: string; generation: number }>(
        `INSERT INTO render_jobs (recap_id, variant)
         VALUES ($1, $2)
         RETURNING id, generation`,
        [recapId, variant],
      )
      const job = jobResult.rows[0]!
      await client.query(
        `INSERT INTO render_outbox (job_id, generation, payload)
         VALUES ($1, $2, $3::jsonb)`,
        [job.id, job.generation, JSON.stringify({ jobId: job.id, generation: job.generation })],
      )
    }

    await client.query('COMMIT')
    return { recapId, version, reused: false }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
