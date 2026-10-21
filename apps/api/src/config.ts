export interface ApiConfig {
  port: number
  host: string
  appEnv: 'development' | 'production'
  authMode: 'dev' | 'cognito'
  authIssuer: string
  authAudience: string
  authCodeSecret?: string
  authDevJwtPrivateKey?: string
  authJwksUrl?: string
  databaseUrl: string
  placesCandidateSecret: string
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
  const appEnv = optional(environment, 'APP_ENV') ?? 'development'
  if (appEnv !== 'development' && appEnv !== 'production') {
    throw new Error('Variável APP_ENV precisa ser "development" ou "production".')
  }

  const authMode = optional(environment, 'AUTH_MODE') ?? 'dev'
  if (authMode !== 'dev' && authMode !== 'cognito') {
    throw new Error('Variável AUTH_MODE precisa ser "dev" ou "cognito".')
  }
  if (appEnv === 'production' && authMode === 'dev') {
    throw new Error('AUTH_MODE=dev não pode ser usado com APP_ENV=production.')
  }

  let authCodeSecret: string | undefined
  let authDevJwtPrivateKey: string | undefined
  let authIssuer = 'trippy-dev-auth'
  let authAudience = 'trippy-dev'
  let authJwksUrl: string | undefined
  if (authMode === 'dev') {
    authCodeSecret = required(environment, 'AUTH_CODE_SECRET')
    authDevJwtPrivateKey = required(environment, 'AUTH_DEV_JWT_PRIVATE_KEY')
    authIssuer = optional(environment, 'AUTH_ISSUER') ?? authIssuer
    authAudience = optional(environment, 'AUTH_AUDIENCE') ?? authAudience
  } else {
    authIssuer = required(environment, 'AUTH_ISSUER')
    authAudience = required(environment, 'AUTH_AUDIENCE')
    authJwksUrl = required(environment, 'AUTH_JWKS_URL')
    let jwks: URL
    try {
      jwks = new URL(authJwksUrl)
    } catch {
      throw new Error('AUTH_JWKS_URL precisa ser uma URL válida.')
    }
    if (appEnv === 'production' && jwks.protocol !== 'https:') {
      throw new Error('AUTH_JWKS_URL precisa usar HTTPS em produção.')
    }
  }

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
    appEnv,
    authMode,
    authIssuer,
    authAudience,
    ...(authCodeSecret ? { authCodeSecret } : {}),
    ...(authDevJwtPrivateKey ? { authDevJwtPrivateKey } : {}),
    ...(authJwksUrl ? { authJwksUrl } : {}),
    databaseUrl: required(environment, 'DATABASE_URL'),
    placesCandidateSecret: required(environment, 'PLACES_CANDIDATE_SECRET'),
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
