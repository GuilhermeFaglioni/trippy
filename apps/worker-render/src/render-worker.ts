import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { bundle } from '@remotion/bundler'
import { makeCancelSignal, renderMedia, selectComposition } from '@remotion/renderer'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type { RecapSnapshot } from '@trippy/domain'
import { loadStorageConfig } from './config.ts'
import {
  completeJob,
  getJobRenderInput,
  isJobVideoPublished,
  reconcileInterruptedJob,
  renewJobLease,
} from './persistence.ts'

const chromiumExecutable = '/usr/bin/chromium'
const entryPoint = fileURLToPath(new URL('./remotion-entry.tsx', import.meta.url))

type RenderJobEnvironment = Readonly<{
  jobId: string
  fencingToken: number
}>

type DownloadedPhoto = Readonly<{ src: string; placeName: string | null }>

type CgroupSample = Readonly<{ cpuUsageMicroseconds: bigint }>

export async function renderJob(
  environment: RenderJobEnvironment,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config = loadStorageConfig(env)
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 })
  const s3 = new S3Client({
    endpoint: config.s3Endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  })
  const workspace = await mkdtemp(join(tmpdir(), 'trippy-remotion-'))
  let uploadedKey: string | null = null
  let releaseLeaseTimer: NodeJS.Timeout | undefined
  let leaseLost = false

  try {
    const renderInput = await getJobRenderInput(pool, environment)
    if (!renderInput) throw new Error('Job não possui lease atual para esta geração')

    const publicDirectory = join(workspace, 'public')
    const outputLocation = join(workspace, 'recap.mp4')
    const downloadedPhotos = await downloadPhotos(
      s3,
      config.photosBucket,
      renderInput.snapshot,
      publicDirectory,
    )
    const inputProps = {
      snapshot: renderInput.snapshot,
      photos: downloadedPhotos,
      watermarked: renderInput.variant === 'watermarked',
    }

    // Cada job ocupa container próprio; memory.peak mede o pico desde sua criação.
    const before = await readCgroupSample()
    const start = process.hrtime.bigint()
    const cancellation = makeCancelSignal()
    let renewalInProgress = false
    releaseLeaseTimer = setInterval(
      () => {
        if (renewalInProgress || leaseLost) return
        renewalInProgress = true
        void renewJobLease(pool, {
          jobId: environment.jobId,
          fencingToken: environment.fencingToken,
          leaseDurationMs: config.leaseDurationMs,
        })
          .then((renewed) => {
            if (!renewed) {
              leaseLost = true
              cancellation.cancel()
            }
          })
          .catch(() => {
            leaseLost = true
            cancellation.cancel()
          })
          .finally(() => {
            renewalInProgress = false
          })
      },
      Math.max(10_000, Math.floor(config.leaseDurationMs / 3)),
    )
    releaseLeaseTimer.unref()

    const serveUrl = await bundle({
      entryPoint,
      publicDir: publicDirectory,
      onProgress: (progress) => logProgress('bundle', progress),
    })
    const composition = await selectComposition({
      serveUrl,
      id: 'TrippyRecap',
      inputProps,
      browserExecutable: chromiumExecutable,
    })
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: 'h264',
      outputLocation,
      browserExecutable: chromiumExecutable,
      concurrency: 2,
      cancelSignal: cancellation.cancelSignal,
      onProgress: ({ progress }) => logProgress('render', progress),
      timeoutInMilliseconds: 60_000,
      logLevel: 'warn',
    })
    if (leaseLost) throw new Error('Lease de render perdido durante a composição')

    const elapsedMilliseconds = Number((process.hrtime.bigint() - start) / 1_000_000n)
    const after = await readCgroupSample()
    const memoryPeakBytes = await readPeakMemory()
    const metrics = {
      renderMilliseconds: elapsedMilliseconds,
      cpuMilliseconds: Number((after.cpuUsageMicroseconds - before.cpuUsageMicroseconds) / 1_000n),
      peakMemoryBytes: memoryPeakBytes,
    }

    if (
      !(await renewJobLease(pool, {
        ...environment,
        leaseDurationMs: config.leaseDurationMs,
      }))
    ) {
      throw new Error('Lease de render perdido antes do upload')
    }

    const videoKey = `recaps/${renderInput.recapId}/v${renderInput.version}/${renderInput.variant}/fence-${environment.fencingToken}.mp4`
    uploadedKey = videoKey
    const outputStat = await stat(outputLocation)
    await s3.send(
      new PutObjectCommand({
        Bucket: config.videosBucket,
        Key: videoKey,
        Body: createReadStream(outputLocation),
        ContentLength: outputStat.size,
        ContentType: 'video/mp4',
      }),
    )

    const completion = await completeJob(pool, {
      jobId: environment.jobId,
      fencingToken: environment.fencingToken,
      videoKey,
      metrics,
    })
    if (!completion.completed) {
      await s3.send(new DeleteObjectCommand({ Bucket: config.videosBucket, Key: videoKey }))
      uploadedKey = null
      throw new Error(`Resultado descartado pela cerca: ${completion.reason}`)
    }
    uploadedKey = null
    console.log(
      JSON.stringify({
        event: 'render-completed',
        jobId: environment.jobId,
        fencingToken: environment.fencingToken,
        videoKey,
        ...metrics,
      }),
    )
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Falha desconhecida no render'
    await reconcileInterruptedJob(pool, {
      jobId: environment.jobId,
      fencingToken: environment.fencingToken,
      reason,
    })
    if (uploadedKey) {
      const published = await isJobVideoPublished(pool, {
        jobId: environment.jobId,
        fencingToken: environment.fencingToken,
        videoKey: uploadedKey,
      }).catch(() => true)
      if (!published) {
        await s3
          .send(new DeleteObjectCommand({ Bucket: config.videosBucket, Key: uploadedKey }))
          .catch(() => {
            console.error(
              JSON.stringify({
                event: 'stale-render-artifact-cleanup-failed',
                jobId: environment.jobId,
                fencingToken: environment.fencingToken,
              }),
            )
          })
      }
    }
    throw error
  } finally {
    if (releaseLeaseTimer) clearInterval(releaseLeaseTimer)
    s3.destroy()
    await pool.end()
    await rm(workspace, { recursive: true, force: true })
  }
}

async function downloadPhotos(
  s3: S3Client,
  bucket: string,
  snapshot: RecapSnapshot,
  publicDirectory: string,
): Promise<DownloadedPhoto[]> {
  await mkdir(publicDirectory, { recursive: true })
  const photos: DownloadedPhoto[] = []
  for (const [index, photo] of snapshot.photos.entries()) {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: photo.storageKey }))
    if (!response.Body) throw new Error(`Foto sem conteúdo no MinIO: ${photo.id}`)
    const extension =
      extname(photo.storageKey).toLowerCase() ||
      (photo.contentType === 'image/png' ? '.png' : '.jpg')
    const filename = `photo-${index}${extension}`
    await writeFile(join(publicDirectory, filename), await response.Body.transformToByteArray())
    const place = snapshot.places.find(({ id }) => id === photo.placeId)
    photos.push({ src: filename, placeName: place?.localName || place?.name || null })
  }
  return photos
}

async function readPeakMemory(): Promise<number> {
  const value = Number((await readFile('/sys/fs/cgroup/memory.peak', 'utf8')).trim())
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('O cgroup não retornou pico de memória válido')
  }
  return value
}

async function readCgroupSample(): Promise<CgroupSample> {
  const stats = await readFile('/sys/fs/cgroup/cpu.stat', 'utf8')
  const usage = stats.match(/^usage_usec\s+(\d+)$/m)?.[1]
  if (!usage) throw new Error('O cgroup não expôs cpu.stat/usage_usec')
  return { cpuUsageMicroseconds: BigInt(usage) }
}

function logProgress(stage: 'bundle' | 'render', progress: number): void {
  const percentage = Math.round(progress * 100)
  console.log(JSON.stringify({ event: 'render-progress', stage, percentage }))
}

function readEnvironment(env: NodeJS.ProcessEnv): RenderJobEnvironment {
  const jobId = env.RENDER_JOB_ID
  const fencingToken = Number(env.RENDER_FENCING_TOKEN)
  if (!jobId || !Number.isSafeInteger(fencingToken) || fencingToken < 1) {
    throw new Error('RENDER_JOB_ID e RENDER_FENCING_TOKEN são obrigatórios')
  }
  return { jobId, fencingToken }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  renderJob(readEnvironment(process.env)).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ event: 'render-failed', reason }))
    process.exitCode = 1
  })
}
