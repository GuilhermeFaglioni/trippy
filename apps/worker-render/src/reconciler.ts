import type { DispatcherConfig } from './config.ts'
import type { DockerRuntime } from './docker-runtime.ts'
import {
  getRunningJob,
  listRunningJobs,
  publishOutboxBatch,
  reconcileInterruptedJob,
  tryAcquireJobLaunchGuard,
} from './persistence.ts'
import type { SQSClient } from '@aws-sdk/client-sqs'
import pg from 'pg'

type Pool = InstanceType<typeof pg.Pool>

export type ReconciliationSummary = Readonly<{
  checked: number
  active: number
  requeued: number
  failed: number
  outboxPublished: number
}>

export async function reconcileWorkers(
  pool: Pool,
  runtime: Pick<DockerRuntime, 'inspect' | 'stop' | 'remove'>,
  limit = 20,
): Promise<Omit<ReconciliationSummary, 'outboxPublished'>> {
  const jobs = await listRunningJobs(pool, limit)
  let active = 0
  let requeued = 0
  let failed = 0

  for (const candidate of jobs) {
    const guard = await tryAcquireJobLaunchGuard(pool, candidate.id)
    if (!guard) {
      // Dispatcher ainda está entre claim e confirmação do container no Docker.
      active += 1
      continue
    }
    try {
      const job = await getRunningJob(pool, candidate.id)
      if (!job) continue
      const state = await runtime.inspect(job.executionId)
      if (state.status === 'foreign') {
        throw new Error('Worker do banco aponta para container fora deste ensaio')
      }

      const leaseExpired = job.leaseExpired
      if (!leaseExpired && state.status !== 'exited') {
        active += 1
        continue
      }

      if (
        leaseExpired &&
        (state.status === 'running' || state.status === 'created' || state.status === 'paused')
      ) {
        await runtime.stop(job.executionId)
      }

      const reason =
        state.status === 'missing'
          ? 'Container de render não existe mais'
          : state.status === 'exited'
            ? `Container de render encerrou com código ${state.exitCode ?? 'desconhecido'}`
            : 'Lease de render expirou'
      const result = await reconcileInterruptedJob(pool, {
        jobId: job.id,
        fencingToken: job.fencingToken,
        reason,
      })
      if (result.status === 'requeued') requeued += 1
      if (result.status === 'failed') failed += 1
      await runtime.remove(job.executionId)
    } finally {
      await guard.release()
    }
  }

  return { checked: jobs.length, active, requeued, failed }
}

export async function reconcileCycle(
  pool: Pool,
  sqs: SQSClient,
  runtime: Pick<DockerRuntime, 'inspect' | 'stop' | 'remove'>,
  config: DispatcherConfig,
): Promise<ReconciliationSummary> {
  const jobs = await reconcileWorkers(pool, runtime, 20)
  const outboxPublished = await publishOutboxBatch(pool, sqs, config.queueUrl, 10)
  return { ...jobs, outboxPublished }
}

export async function runReconciler(
  pool: Pool,
  sqs: SQSClient,
  runtime: Pick<DockerRuntime, 'inspect' | 'stop' | 'remove'>,
  config: DispatcherConfig,
  signal: AbortSignal,
): Promise<void> {
  const lock = await pool.connect()
  try {
    const result = await lock.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [`trippy:spike19:${config.runId}:reconciler`],
    )
    if (!result.rows[0]!.acquired) throw new Error('Outro reconciliador já controla este ensaio')

    while (!signal.aborted) {
      await reconcileCycle(pool, sqs, runtime, config)
      await wait(60_000, signal)
    }
  } finally {
    try {
      await lock.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
        `trippy:spike19:${config.runId}:reconciler`,
      ])
    } finally {
      lock.release()
    }
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener('abort', finish, { once: true })
  })
}
