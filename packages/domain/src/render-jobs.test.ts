import { describe, expect, it } from 'vitest'
import { claimRenderJob, completeRenderJob, reconcileRenderJob, type RenderJob } from './render-jobs.ts'

const queuedJob = (overrides: Partial<RenderJob> = {}): RenderJob => ({
  id: 'job-1',
  recapId: 'recap-1',
  variant: 'clean',
  status: 'queued',
  generation: 1,
  attempts: 0,
  fencingToken: 0,
  leaseExpiresAt: null,
  executionId: null,
  videoKey: null,
  ...overrides,
})

describe('claimRenderJob', () => {
  it('claims only the queued generation and issues a new lease fence', () => {
    const result = claimRenderJob(queuedJob(), 1, 1_000, 30_000)

    expect(result).toEqual({
      claimed: true,
      job: {
        ...queuedJob(),
        status: 'running',
        attempts: 1,
        fencingToken: 1,
        leaseExpiresAt: 31_000,
      },
    })
  })

  it('does not claim a duplicate message while the job already has an active lease', () => {
    const active = queuedJob({ status: 'running', attempts: 1, fencingToken: 1, leaseExpiresAt: 31_000 })

    expect(claimRenderJob(active, 1, 2_000, 30_000)).toEqual({ claimed: false, reason: 'not-queued' })
  })

  it('ignores an outbox message from an older dispatch generation', () => {
    const retried = queuedJob({ generation: 2 })

    expect(claimRenderJob(retried, 1, 2_000, 30_000)).toEqual({
      claimed: false,
      reason: 'stale-generation',
    })
  })

  it('rejects invalid leases instead of creating an unbounded worker claim', () => {
    expect(claimRenderJob(queuedJob(), 1, 1_000, 0)).toEqual({
      claimed: false,
      reason: 'invalid-lease',
    })
  })
})

describe('completeRenderJob', () => {
  const active = queuedJob({
    status: 'running',
    attempts: 1,
    fencingToken: 4,
    leaseExpiresAt: 31_000,
    executionId: 'container-4',
  })

  it('accepts output from the current worker before its lease expires', () => {
    expect(completeRenderJob(active, 4, 30_999, 'recaps/1/clean/4.mp4')).toEqual({
      completed: true,
      job: {
        ...active,
        status: 'succeeded',
        leaseExpiresAt: null,
        videoKey: 'recaps/1/clean/4.mp4',
      },
    })
  })

  it('rejects output from a stale worker and output after lease expiry', () => {
    expect(completeRenderJob(active, 3, 30_000, 'stale.mp4')).toEqual({
      completed: false,
      reason: 'stale-fence',
    })
    expect(completeRenderJob(active, 4, 31_000, 'late.mp4')).toEqual({
      completed: false,
      reason: 'lease-expired',
    })
  })
})

describe('reconcileRenderJob', () => {
  it('requeues an interrupted worker with a new generation', () => {
    const active = queuedJob({
      status: 'running',
      generation: 2,
      attempts: 1,
      fencingToken: 1,
      leaseExpiresAt: 31_000,
      executionId: 'container-1',
    })

    expect(reconcileRenderJob(active, 2_000, true, 3)).toEqual({
      reconciled: true,
      job: {
        ...active,
        status: 'queued',
        generation: 3,
        leaseExpiresAt: null,
        executionId: null,
      },
    })
  })

  it('marks the job terminal after the configured attempt limit', () => {
    const lastAttempt = queuedJob({
      status: 'running',
      attempts: 3,
      fencingToken: 3,
      leaseExpiresAt: 1_000,
      executionId: 'container-3',
    })

    expect(reconcileRenderJob(lastAttempt, 1_000, false, 3)).toEqual({
      reconciled: true,
      job: {
        ...lastAttempt,
        status: 'failed',
        leaseExpiresAt: null,
        executionId: null,
      },
    })
  })

  it('leaves a healthy worker and a terminal job untouched', () => {
    const healthy = queuedJob({ status: 'running', leaseExpiresAt: 5_000 })
    const terminal = queuedJob({ status: 'failed' })

    expect(reconcileRenderJob(healthy, 1_000, false, 3)).toEqual({
      reconciled: false,
      reason: 'worker-active',
      job: healthy,
    })
    expect(reconcileRenderJob(terminal, 1_000, true, 3)).toEqual({
      reconciled: false,
      reason: 'not-running',
      job: terminal,
    })
  })
})
