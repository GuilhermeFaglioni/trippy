import {
  claimQueuedJob,
  publishOutboxBatch,
  reconcileInterruptedJob,
  registerJobExecution,
} from './persistence.ts'
import {
  deleteMessage,
  parseRenderQueueMessage,
  receiveOne,
  type RenderQueueMessage,
} from './queue.ts'
import type { DispatcherConfig } from './config.ts'
import type { DockerRuntime } from './docker-runtime.ts'
import pg from 'pg'
import type { SQSClient } from '@aws-sdk/client-sqs'

type Pool = InstanceType<typeof pg.Pool>

export type DispatchOutcome =
  | { kind: 'idle' | 'busy' | 'duplicate' | 'stale' | 'invalid-message' }
  | { kind: 'started'; jobId: string; fencingToken: number; containerId: string }
  | { kind: 'retry-scheduled'; jobId: string; status: 'requeued' | 'failed' }

export async function dispatchOne(
  pool: Pool,
  sqs: SQSClient,
  runtime: Pick<DockerRuntime, 'launchWorker' | 'stop' | 'remove'>,
  config: DispatcherConfig,
): Promise<DispatchOutcome> {
  await publishOutboxBatch(pool, sqs, config.queueUrl, 10)

  const active = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM render_jobs WHERE status = 'running'",
  )
  if (active.rows[0]!.count > 0) return { kind: 'busy' }

  const message = await receiveOne(sqs, config.queueUrl)
  if (!message) return { kind: 'idle' }

  let payload: RenderQueueMessage
  try {
    if (!message.Body) throw new Error('Mensagem SQS sem conteúdo')
    payload = parseRenderQueueMessage(message.Body)
  } catch {
    await deleteMessage(sqs, config.queueUrl, message)
    return { kind: 'invalid-message' }
  }

  const claim = await claimQueuedJob(pool, {
    ...payload,
    leaseDurationMs: config.leaseDurationMs,
  })
  if (!claim.claimed) {
    if (claim.reason === 'invalid-lease') throw new Error('Lease de render inválido')
    await deleteMessage(sqs, config.queueUrl, message)
    return { kind: claim.reason === 'stale-generation' ? 'stale' : 'duplicate' }
  }

  try {
    let containerId: string
    try {
      containerId = await runtime.launchWorker({
        jobId: payload.jobId,
        fencingToken: claim.job.fencingToken,
        executionName: claim.executionId,
      })
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'Falha desconhecida ao iniciar o container'
      try {
        await runtime.stop(claim.executionId)
        await runtime.remove(claim.executionId)
      } catch {
        // The persisted launch name and later reconciliation remain the recovery path.
      }
      const transition = await reconcileInterruptedJob(pool, {
        jobId: payload.jobId,
        fencingToken: claim.job.fencingToken,
        reason: `Falha ao iniciar container: ${reason}`,
      })
      await deleteMessage(sqs, config.queueUrl, message)
      if (transition.status === 'requeued' || transition.status === 'failed') {
        return { kind: 'retry-scheduled', jobId: payload.jobId, status: transition.status }
      }
      return { kind: 'duplicate' }
    }

    const registered = await registerJobExecution(pool, {
      jobId: payload.jobId,
      fencingToken: claim.job.fencingToken,
      executionId: containerId,
    })
    if (!registered) {
      await runtime.stop(containerId)
      await runtime.remove(containerId)
      const transition = await reconcileInterruptedJob(pool, {
        jobId: payload.jobId,
        fencingToken: claim.job.fencingToken,
        reason: 'Lease expirou durante a inicialização do container',
      })
      await deleteMessage(sqs, config.queueUrl, message)
      if (transition.status === 'requeued' || transition.status === 'failed') {
        return { kind: 'retry-scheduled', jobId: payload.jobId, status: transition.status }
      }
      return { kind: 'duplicate' }
    }

    await deleteMessage(sqs, config.queueUrl, message)
    return {
      kind: 'started',
      jobId: payload.jobId,
      fencingToken: claim.job.fencingToken,
      containerId,
    }
  } finally {
    await claim.releaseLaunchGuard()
  }
}

export async function runDispatcher(
  pool: Pool,
  sqs: SQSClient,
  runtime: DockerRuntime,
  config: DispatcherConfig,
  signal: AbortSignal,
): Promise<void> {
  const lock = await pool.connect()
  try {
    const result = await lock.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [`trippy:spike19:${config.runId}:dispatcher`],
    )
    if (!result.rows[0]!.acquired) throw new Error('Outro dispatcher já controla este ensaio')

    while (!signal.aborted) {
      const outcome = await dispatchOne(pool, sqs, runtime, config)
      if (outcome.kind === 'idle' || outcome.kind === 'busy') {
        await wait(1_000, signal)
      }
    }
  } finally {
    try {
      await lock.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
        `trippy:spike19:${config.runId}:dispatcher`,
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
