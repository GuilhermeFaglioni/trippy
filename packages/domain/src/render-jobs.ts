export type RenderVariant = 'clean' | 'watermarked'
export type RenderJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type RenderJob = Readonly<{
  id: string
  recapId: string
  variant: RenderVariant
  status: RenderJobStatus
  generation: number
  attempts: number
  fencingToken: number
  leaseExpiresAt: number | null
  executionId: string | null
  videoKey: string | null
}>

export type ClaimRenderJobResult =
  | { claimed: true; job: RenderJob }
  | { claimed: false; reason: 'stale-generation' | 'not-queued' | 'invalid-lease' }

export function claimRenderJob(
  job: RenderJob,
  expectedGeneration: number,
  now: number,
  leaseDurationMs: number,
): ClaimRenderJobResult {
  if (job.generation !== expectedGeneration) return { claimed: false, reason: 'stale-generation' }
  if (job.status !== 'queued') return { claimed: false, reason: 'not-queued' }
  if (!Number.isFinite(now) || !Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) {
    return { claimed: false, reason: 'invalid-lease' }
  }

  return {
    claimed: true,
    job: {
      ...job,
      status: 'running',
      attempts: job.attempts + 1,
      fencingToken: job.fencingToken + 1,
      leaseExpiresAt: now + leaseDurationMs,
    },
  }
}

export type CompleteRenderJobResult =
  | { completed: true; job: RenderJob }
  | { completed: false; reason: 'not-running' | 'stale-fence' | 'lease-expired' }

export function completeRenderJob(
  job: RenderJob,
  fencingToken: number,
  now: number,
  videoKey: string,
): CompleteRenderJobResult {
  if (job.status !== 'running') return { completed: false, reason: 'not-running' }
  if (job.fencingToken !== fencingToken) return { completed: false, reason: 'stale-fence' }
  if (job.leaseExpiresAt === null || now >= job.leaseExpiresAt) {
    return { completed: false, reason: 'lease-expired' }
  }

  return {
    completed: true,
    job: { ...job, status: 'succeeded', leaseExpiresAt: null, videoKey },
  }
}

export type ReconcileRenderJobResult =
  | { reconciled: true; job: RenderJob }
  | { reconciled: false; reason: 'not-running' | 'worker-active'; job: RenderJob }

export function reconcileRenderJob(
  job: RenderJob,
  now: number,
  workerExited: boolean,
  maxAttempts: number,
): ReconcileRenderJobResult {
  if (job.status !== 'running') return { reconciled: false, reason: 'not-running', job }

  const leaseExpired = job.leaseExpiresAt === null || now >= job.leaseExpiresAt
  if (!workerExited && !leaseExpired) return { reconciled: false, reason: 'worker-active', job }

  const retryAvailable = job.attempts < maxAttempts
  return {
    reconciled: true,
    job: {
      ...job,
      status: retryAvailable ? 'queued' : 'failed',
      generation: retryAvailable ? job.generation + 1 : job.generation,
      leaseExpiresAt: null,
      executionId: null,
    },
  }
}
