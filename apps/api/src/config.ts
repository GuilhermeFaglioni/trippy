export interface ApiConfig {
  port: number
  host: string
  databaseUrl: string
  awsRegion: string
  awsAccessKeyId?: string
  awsSecretAccessKey?: string
  s3Endpoint?: string
  s3ForcePathStyle: boolean
  s3BucketPhotos: string
  sqsEndpoint?: string
  sqsQueueThumbs: string
  smtpHost: string
  smtpPort: number
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`Variável obrigatória não definida: ${name}.`)
  return value
}

function optional(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = environment[name]?.trim()
  return value || undefined
}

function integer(environment: NodeJS.ProcessEnv, name: string, fallback?: number): number {
  const value = optional(environment, name)
  if (!value && fallback !== undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Variável ${name} precisa ser um inteiro positivo.`)
  }
  return parsed
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const accessKeyId = optional(environment, 'AWS_ACCESS_KEY_ID')
  const secretAccessKey = optional(environment, 'AWS_SECRET_ACCESS_KEY')
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error('AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY precisam estar definidas juntas.')
  }

  const forcePathStyle = optional(environment, 'S3_FORCE_PATH_STYLE')?.toLowerCase() ?? 'false'
  if (forcePathStyle !== 'true' && forcePathStyle !== 'false') {
    throw new Error('Variável S3_FORCE_PATH_STYLE precisa ser "true" ou "false".')
  }

  const s3Endpoint = optional(environment, 'S3_ENDPOINT')
  const sqsEndpoint = optional(environment, 'SQS_ENDPOINT')

  return {
    port: integer(environment, 'PORT', 3000),
    host: optional(environment, 'HOST') ?? '127.0.0.1',
    databaseUrl: required(environment, 'DATABASE_URL'),
    awsRegion: optional(environment, 'AWS_REGION') ?? 'us-east-1',
    ...(accessKeyId ? { awsAccessKeyId: accessKeyId } : {}),
    ...(secretAccessKey ? { awsSecretAccessKey: secretAccessKey } : {}),
    ...(s3Endpoint ? { s3Endpoint } : {}),
    s3ForcePathStyle: forcePathStyle === 'true',
    s3BucketPhotos: required(environment, 'S3_BUCKET_PHOTOS'),
    ...(sqsEndpoint ? { sqsEndpoint } : {}),
    sqsQueueThumbs: required(environment, 'SQS_QUEUE_THUMBS'),
    smtpHost: required(environment, 'SMTP_HOST'),
    smtpPort: integer(environment, 'SMTP_PORT'),
  }
}
