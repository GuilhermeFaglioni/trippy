import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { CreateQueueCommand, DeleteQueueCommand } from '@aws-sdk/client-sqs'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { migrate } from '../../../packages/db/src/migrate.ts'
import { createRecap, listRunningJobs } from './persistence.ts'
import { loadDispatcherConfig, loadStorageConfig } from './config.ts'
import { dispatchOne } from './dispatcher.ts'
import { DockerRuntime } from './docker-runtime.ts'
import { createQueueClient } from './queue.ts'
import { reconcileCycle } from './reconciler.ts'

const fixturePath = fileURLToPath(new URL('../fixtures/beijing-courtyard.png', import.meta.url))
const migrationDirectory = fileURLToPath(
  new URL('../../../packages/db/migrations/', import.meta.url),
)

type VideoEvidence = Readonly<{
  scenario: 'sem-fotos' | 'com-foto'
  variant: 'clean' | 'watermarked'
  jobId: string
  videoKey: string
  sizeBytes: number
  sha256: string
  durationSeconds: number
  width: number
  height: number
  codec: string
  renderMilliseconds: number
  cpuMilliseconds: number
  peakMemoryBytes: number
}>

export async function runRehearsal(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const runId = randomUUID()
  const suffix = runId.replaceAll('-', '').slice(0, 12)
  const photoBucket = `trippy-spike19-p-${suffix}`
  const videoBucket = `trippy-spike19-v-${suffix}`
  const queueName = `trippy-spike19-${suffix}`
  const configuredImage = env.RENDER_IMAGE ?? 'trippy-worker-render:spike19'
  if (!/^trippy-worker-render:spike19(?:-[a-f0-9]{12})?$/.test(configuredImage)) {
    throw new Error('RENDER_IMAGE do ensaio precisa usar o namespace trippy-worker-render:spike19')
  }

  const environment: NodeJS.ProcessEnv = {
    ...env,
    S3_BUCKET_PHOTOS: photoBucket,
    S3_BUCKET_VIDEOS: videoBucket,
    TRIPPY_SPIKE_RUN_ID: runId,
    RENDER_IMAGE: configuredImage,
    RENDER_LEASE_DURATION_MS: '30000',
  }
  const storageConfig = loadStorageConfig(environment)
  assertLocalEndpoint(storageConfig.databaseUrl, 'Postgres')
  assertLocalEndpoint(storageConfig.s3Endpoint, 'MinIO')
  const s3 = new S3Client({
    endpoint: storageConfig.s3Endpoint,
    region: storageConfig.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: storageConfig.accessKeyId,
      secretAccessKey: storageConfig.secretAccessKey,
    },
  })
  const sqs = createQueueClient({
    sqsEndpoint: environment.SQS_ENDPOINT ?? 'http://localhost:59324',
    region: storageConfig.region,
    accessKeyId: storageConfig.accessKeyId,
    secretAccessKey: storageConfig.secretAccessKey,
  })
  assertLocalEndpoint(environment.SQS_ENDPOINT ?? 'http://localhost:59324', 'ElasticMQ')

  let queueUrl: string | undefined
  let photoBucketCreated = false
  let videoBucketCreated = false
  let keepVideos = false
  let databaseCreated = false
  let pool: InstanceType<typeof pg.Pool> | undefined
  let testDatabaseUrl: string | undefined
  let dispatcherConfig: ReturnType<typeof loadDispatcherConfig> | undefined
  let runtime: DockerRuntime | undefined
  const evidenceDirectory = await mkdtemp(join(tmpdir(), `trippy-spike19-${suffix}-`))

  try {
    await createBucket(s3, photoBucket)
    photoBucketCreated = true
    await createBucket(s3, videoBucket)
    videoBucketCreated = true
    const queue = await sqs.send(new CreateQueueCommand({ QueueName: queueName }))
    if (!queue.QueueUrl) throw new Error('ElasticMQ não retornou URL para a fila isolada')
    queueUrl = queue.QueueUrl

    const { adminUrl, databaseName, databaseUrl } = makeTestDatabaseUrl(
      storageConfig.databaseUrl,
      suffix,
    )
    testDatabaseUrl = databaseUrl
    await createDatabase(adminUrl, databaseName)
    databaseCreated = true
    await migrate({ databaseUrl, migrationsDirectory: migrationDirectory })
    pool = new pg.Pool({ connectionString: databaseUrl, max: 4 })
    dispatcherConfig = loadDispatcherConfig({
      ...environment,
      DATABASE_URL: databaseUrl,
      SQS_QUEUE_URL: queueUrl,
    })

    const owner = await pool.query<{ id: string }>(
      "INSERT INTO users (name, email) VALUES ('Spike 19', 'spike19@example.test') RETURNING id",
    )
    const trip = await pool.query<{ id: string }>(
      `INSERT INTO trips (name, destination, start_date, end_date, timezone, organizer_id)
       VALUES ('Memórias em grupo', 'Pequim', '2026-09-01', '2026-09-03', 'Asia/Shanghai', $1)
       RETURNING id`,
      [owner.rows[0]!.id],
    )
    const createdTripId = trip.rows[0]!.id

    await s3.send(
      new PutObjectCommand({
        Bucket: photoBucket,
        Key: 'fixtures/beijing-courtyard.png',
        Body: await readFile(fixturePath),
        ContentType: 'image/png',
      }),
    )

    const noPhotoRecap = await createRecap(pool, {
      tripId: createdTripId,
      idempotencyKey: `spike19-no-photo-${suffix}`,
      createdAt: new Date().toISOString(),
      content: {
        places: [
          {
            id: 'temple-of-heaven',
            name: 'Temple of Heaven',
            localName: '天坛',
            address: 'Beijing',
            dayIndex: 0,
            position: 0,
            visits: 1,
            favorites: 1,
          },
          {
            id: 'forbidden-city',
            name: 'Forbidden City',
            localName: '故宫',
            address: 'Beijing',
            dayIndex: 1,
            position: 0,
            visits: 2,
            favorites: 0,
          },
        ],
        photos: [],
      },
    })
    const photoRecap = await createRecap(pool, {
      tripId: createdTripId,
      idempotencyKey: `spike19-photo-${suffix}`,
      createdAt: new Date().toISOString(),
      content: {
        places: [
          {
            id: 'temple-of-heaven-photo',
            name: 'Temple of Heaven',
            localName: '天坛',
            address: 'Beijing',
            dayIndex: 0,
            position: 0,
            visits: 1,
            favorites: 1,
          },
        ],
        photos: [
          {
            id: 'beijing-courtyard-fixture',
            storageKey: 'fixtures/beijing-courtyard.png',
            contentType: 'image/png',
            placeId: 'temple-of-heaven-photo',
            takenAt: '2026-09-02T11:00:00.000Z',
          },
        ],
      },
    })

    runtime = new DockerRuntime(dispatcherConfig)
    await runtime.buildImage(fileURLToPath(new URL('../../../', import.meta.url)))
    const imagePlatform = await runtime.imagePlatform()
    if (imagePlatform !== 'linux/amd64') {
      throw new Error(`Imagem Remotion retornou plataforma ${imagePlatform}`)
    }
    const runtimeLoader = await dockerProbe(dispatcherConfig.renderImage, runId, [
      'node',
      '--import',
      'tsx',
      '-e',
      "process.stdout.write('tsx disponível')",
    ])
    if (!runtimeLoader.includes('tsx disponível')) {
      throw new Error('A imagem Remotion não resolveu o loader tsx no worker')
    }
    const cjkFont = await dockerProbe(dispatcherConfig.renderImage, runId, [
      'fc-match',
      '--format=%{family}',
      'Noto Sans CJK SC',
    ])
    if (!cjkFont.includes('Noto Sans CJK'))
      throw new Error(`Fonte Noto CJK indisponível: ${cjkFont}`)

    const outboxCount = await pool.query<{ count: string }>(
      `SELECT count(*) FROM render_outbox WHERE job_id IN (
         SELECT id FROM render_jobs WHERE recap_id IN ($1, $2)
       )`,
      [noPhotoRecap.recapId, photoRecap.recapId],
    )
    if (outboxCount.rows[0]!.count !== '4')
      throw new Error('O ensaio deveria ter quatro jobs de render')

    let dispatchReturnMilliseconds: number | null = null
    let interruptedJobId: string | null = null
    let interruptedFencingToken: number | null = null
    let interruptedAttempts = 0
    const deadline = Date.now() + 30 * 60_000
    while (Date.now() < deadline) {
      await reconcileCycle(pool, sqs, runtime, dispatcherConfig)
      const dispatchStartedAt = performance.now()
      const outcome = await dispatchOne(pool, sqs, runtime, dispatcherConfig)
      if (outcome.kind === 'started' && dispatchReturnMilliseconds === null) {
        dispatchReturnMilliseconds = Math.round(performance.now() - dispatchStartedAt)
        interruptedJobId = outcome.jobId
        interruptedFencingToken = outcome.fencingToken
        await runtime.stop(outcome.containerId)
      }

      const statuses = await pool.query<{
        status: string
        attempts: number
        failed: number
        succeeded: number
      }>(
        `SELECT
           CASE WHEN count(*) FILTER (WHERE status NOT IN ('succeeded', 'failed')) = 0
             THEN 'settled' ELSE 'active' END AS status,
           max(attempts) AS attempts,
           count(*) FILTER (WHERE status = 'failed')::int AS failed,
           count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded
         FROM render_jobs WHERE recap_id IN ($1, $2)`,
        [noPhotoRecap.recapId, photoRecap.recapId],
      )
      const status = statuses.rows[0]!
      if (status.failed > 0) {
        const errors = await pool.query<{ id: string; lastError: string | null }>(
          `SELECT id, last_error AS "lastError" FROM render_jobs
           WHERE recap_id IN ($1, $2) AND status = 'failed'`,
          [noPhotoRecap.recapId, photoRecap.recapId],
        )
        throw new Error(`Render terminou com falha: ${JSON.stringify(errors.rows)}`)
      }
      if (status.status === 'settled' && status.succeeded === 4) break
      await delay(1_000)
    }

    if (
      dispatchReturnMilliseconds === null ||
      interruptedJobId === null ||
      interruptedFencingToken === null
    ) {
      throw new Error('O dispatcher não lançou worker em modo detached')
    }
    const jobStates = await pool.query<{
      id: string
      recapId: string
      variant: 'clean' | 'watermarked'
      status: string
      attempts: number
      fencingToken: string
      videoKey: string | null
      renderMilliseconds: string | null
      cpuMilliseconds: string | null
      peakMemoryBytes: string | null
    }>(
      `SELECT j.id, j.recap_id AS "recapId", j.variant, j.status, j.attempts,
              j.fencing_token AS "fencingToken", j.video_key AS "videoKey",
              j.render_milliseconds AS "renderMilliseconds",
              j.cpu_milliseconds AS "cpuMilliseconds", j.peak_memory_bytes AS "peakMemoryBytes"
       FROM render_jobs j WHERE j.recap_id IN ($1, $2) ORDER BY j.recap_id, j.variant`,
      [noPhotoRecap.recapId, photoRecap.recapId],
    )
    const videoEvidence: VideoEvidence[] = []
    for (const job of jobStates.rows) {
      if (
        job.status !== 'succeeded' ||
        !job.videoKey ||
        !job.renderMilliseconds ||
        !job.cpuMilliseconds ||
        !job.peakMemoryBytes
      ) {
        throw new Error(`Job ${job.id} não persistiu status ou métricas reais`)
      }
      const object = await s3.send(
        new HeadObjectCommand({ Bucket: videoBucket, Key: job.videoKey }),
      )
      if (
        object.ContentType !== 'video/mp4' ||
        !object.ContentLength ||
        object.ContentLength < 10_000
      ) {
        throw new Error(`Objeto MP4 inválido no MinIO: ${job.videoKey}`)
      }
      const response = await s3.send(
        new GetObjectCommand({ Bucket: videoBucket, Key: job.videoKey }),
      )
      if (!response.Body) throw new Error(`Vídeo sem conteúdo no MinIO: ${job.videoKey}`)
      const video = Buffer.from(await response.Body.transformToByteArray())
      const temporaryVideo = join(evidenceDirectory, `${job.id}.mp4`)
      await writeFile(temporaryVideo, video)
      const probe = JSON.parse(
        await dockerProbe(
          dispatcherConfig.renderImage,
          runId,
          [
            'ffprobe',
            '-v',
            'error',
            '-show_entries',
            'format=duration:stream=codec_name,width,height,r_frame_rate',
            '-of',
            'json',
            '-i',
            `/tmp/${basename(temporaryVideo)}`,
          ],
          evidenceDirectory,
          basename(temporaryVideo),
        ),
      ) as {
        streams: Array<{
          codec_name?: string
          width?: number
          height?: number
          r_frame_rate?: string
        }>
        format: { duration?: string }
      }
      const stream = probe.streams.find(({ codec_name }) => codec_name === 'h264')
      const durationSeconds = Number(probe.format.duration)
      if (
        !stream ||
        stream.width !== 540 ||
        stream.height !== 960 ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds < 30 ||
        durationSeconds > 60
      ) {
        throw new Error(`Vídeo fora do critério 9:16/30–60s: ${job.videoKey}`)
      }
      if (object.ContentLength !== video.byteLength) {
        throw new Error(`Tamanho do objeto MinIO divergiu: ${job.videoKey}`)
      }
      const recapScenario = job.recapId === noPhotoRecap.recapId ? 'sem-fotos' : 'com-foto'
      videoEvidence.push({
        scenario: recapScenario,
        variant: job.variant,
        jobId: job.id,
        videoKey: job.videoKey,
        sizeBytes: video.byteLength,
        sha256: createHash('sha256').update(video).digest('hex'),
        durationSeconds,
        width: stream.width,
        height: stream.height,
        codec: 'h264',
        renderMilliseconds: Number(job.renderMilliseconds),
        cpuMilliseconds: Number(job.cpuMilliseconds),
        peakMemoryBytes: Number(job.peakMemoryBytes),
      })

      if (recapScenario === 'com-foto' && job.variant === 'clean') {
        const previewPath = join(evidenceDirectory, 'photo-preview.png')
        await dockerProbe(
          dispatcherConfig.renderImage,
          runId,
          [
            'ffmpeg',
            '-v',
            'error',
            '-ss',
            '1',
            '-i',
            `/tmp/${basename(temporaryVideo)}`,
            '-frames:v',
            '1',
            '-y',
            `/tmp/evidence/${basename(previewPath)}`,
          ],
          evidenceDirectory,
          basename(temporaryVideo),
          evidenceDirectory,
        )
        await stat(previewPath)
      }
    }

    if (videoEvidence.length !== 4) throw new Error('Esperados quatro vídeos finais no MinIO')
    const interruptionState = jobStates.rows.find(({ id }) => id === interruptedJobId)
    if (
      !interruptionState ||
      interruptionState.attempts < 2 ||
      Number(interruptionState.fencingToken) < 2
    ) {
      throw new Error('Ensaio não confirmou reexecução cercada após interromper worker')
    }
    interruptedAttempts = interruptionState.attempts
    keepVideos = true

    console.log(
      JSON.stringify(
        {
          event: 'spike19-rehearsal-completed',
          runId,
          image: configuredImage,
          imagePlatform,
          cjkFont,
          queueName,
          videoBucket,
          forcedInterruptedJob: interruptedJobId,
          forcedInterruptedFencingToken: interruptedFencingToken,
          retriedAttempts: interruptedAttempts,
          dispatcherReturnMilliseconds: dispatchReturnMilliseconds,
          videos: videoEvidence,
        },
        null,
        2,
      ),
    )
  } finally {
    if (pool && runtime) {
      const activeJobs = await listRunningJobs(pool, 100).catch(() => [])
      for (const job of activeJobs) {
        await runtime.stop(job.executionId).catch(() => undefined)
        await runtime.remove(job.executionId).catch(() => undefined)
      }
    }
    await pool?.end()
    if (queueUrl)
      await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined)
    sqs.destroy()
    if (photoBucketCreated) await deleteBucket(s3, photoBucket).catch(() => undefined)
    if (videoBucketCreated && !keepVideos)
      await deleteBucket(s3, videoBucket).catch(() => undefined)
    s3.destroy()
    if (databaseCreated && testDatabaseUrl) {
      const { adminUrl, databaseName } = makeTestDatabaseUrl(storageConfig.databaseUrl, suffix)
      await dropDatabase(adminUrl, databaseName)
    }
    await rm(evidenceDirectory, { recursive: true, force: true })
  }
}

async function createBucket(s3: S3Client, name: string): Promise<void> {
  await s3.send(new CreateBucketCommand({ Bucket: name }))
}

async function deleteBucket(s3: S3Client, name: string): Promise<void> {
  let continuationToken: string | undefined
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: name, ContinuationToken: continuationToken }),
    )
    const objects = page.Contents?.flatMap(({ Key }) => (Key ? [{ Key }] : [])) ?? []
    if (objects.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket: name, Delete: { Objects: objects } }))
    }
    continuationToken = page.NextContinuationToken
  } while (continuationToken)
  await s3.send(new DeleteBucketCommand({ Bucket: name }))
}

function makeTestDatabaseUrl(
  baseDatabaseUrl: string,
  suffix: string,
): Readonly<{ adminUrl: string; databaseName: string; databaseUrl: string }> {
  const databaseName = `trippy_recap19_${suffix}`
  const adminUrl = new URL(baseDatabaseUrl)
  adminUrl.pathname = '/postgres'
  const databaseUrl = new URL(baseDatabaseUrl)
  databaseUrl.pathname = `/${databaseName}`
  return { adminUrl: adminUrl.toString(), databaseName, databaseUrl: databaseUrl.toString() }
}

async function createDatabase(adminUrl: string, databaseName: string): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`)
  } finally {
    await admin.end()
  }
}

async function dropDatabase(adminUrl: string, databaseName: string): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  } finally {
    await admin.end()
  }
}

async function dockerProbe(
  image: string,
  runId: string,
  args: string[],
  mountDirectory?: string,
  inputBasename?: string,
  evidenceDirectory?: string,
): Promise<string> {
  const dockerArgs = [
    'run',
    '--rm',
    '--platform',
    'linux/amd64',
    '--label',
    `com.trippy.spike-run=${runId}`,
  ]
  if (mountDirectory && inputBasename) {
    dockerArgs.push('-v', `${join(mountDirectory, inputBasename)}:/tmp/${inputBasename}:ro`)
  }
  if (evidenceDirectory) {
    dockerArgs.push('-v', `${evidenceDirectory}:/tmp/evidence`)
  }
  dockerArgs.push('--entrypoint', args[0]!, image, ...args.slice(1))
  const result = await run('docker', dockerArgs)
  return result.stdout.trim()
}

function assertLocalEndpoint(value: string, service: string): void {
  const url = new URL(value)
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error(`${service} precisa apontar para serviço local no ensaio`)
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function run(executable: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${executable} ${args[0]} falhou (${code}): ${stderr.trim()}`))
    })
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runRehearsal().catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ event: 'spike19-rehearsal-failed', reason }))
    process.exitCode = 1
  })
}
