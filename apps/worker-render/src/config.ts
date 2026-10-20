export type StorageConfig = Readonly<{
  databaseUrl: string
  s3Endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  photosBucket: string
  videosBucket: string
  leaseDurationMs: number
}>

export type DispatcherConfig = StorageConfig & Readonly<{
  sqsEndpoint: string
  queueUrl: string
  runId: string
  renderImage: string
}>

export function loadStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const leaseDurationMs = Number(env.RENDER_LEASE_DURATION_MS ?? '120000')
  if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 30_000) {
    throw new Error('RENDER_LEASE_DURATION_MS deve ser inteiro e maior ou igual a 30000')
  }

  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://trippy:trippy@localhost:54329/trippy',
    s3Endpoint: env.S3_ENDPOINT ?? 'http://localhost:59000',
    region: env.AWS_REGION ?? 'us-east-1',
    accessKeyId: env.AWS_ACCESS_KEY_ID ?? 'trippy',
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? 'trippy-dev-secret',
    photosBucket: required(env, 'S3_BUCKET_PHOTOS'),
    videosBucket: required(env, 'S3_BUCKET_VIDEOS'),
    leaseDurationMs,
  }
}

export function loadDispatcherConfig(env: NodeJS.ProcessEnv = process.env): DispatcherConfig {
  return {
    ...loadStorageConfig(env),
    sqsEndpoint: env.SQS_ENDPOINT ?? 'http://localhost:59324',
    queueUrl: required(env, 'SQS_QUEUE_URL'),
    runId: required(env, 'TRIPPY_SPIKE_RUN_ID'),
    renderImage: required(env, 'RENDER_IMAGE'),
  }
}

export function containerServiceUrl(value: string): string {
  const url = new URL(value)
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    url.hostname = 'host.docker.internal'
  }
  return url.toString().replace(/\/$/, '')
}

export function containerDatabaseUrl(value: string): string {
  const url = new URL(value)
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    url.hostname = 'host.docker.internal'
  }
  return url.toString()
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim()
  if (!value) throw new Error(`${key} não definido`)
  return value
}
