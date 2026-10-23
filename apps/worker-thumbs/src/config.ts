export type ThumbWorkerConfig = Readonly<{
  databaseUrl: string
  s3Endpoint?: string
  s3ForcePathStyle: boolean
  s3BucketPhotos: string
  sqsEndpoint?: string
  sqsQueueThumbs: string
  awsRegion: string
  awsAccessKeyId?: string
  awsSecretAccessKey?: string
}>

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`Variável obrigatória não definida: ${name}.`)
  return value
}

export function loadThumbWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ThumbWorkerConfig {
  const accessKeyId = environment.AWS_ACCESS_KEY_ID?.trim()
  const secretAccessKey = environment.AWS_SECRET_ACCESS_KEY?.trim()
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error('AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY precisam estar definidas juntas.')
  }

  const pathStyle = environment.S3_FORCE_PATH_STYLE?.trim().toLowerCase() ?? 'false'
  if (pathStyle !== 'true' && pathStyle !== 'false') {
    throw new Error('Variável S3_FORCE_PATH_STYLE precisa ser "true" ou "false".')
  }

  return {
    databaseUrl: required(environment, 'DATABASE_URL'),
    ...(environment.S3_ENDPOINT?.trim() ? { s3Endpoint: environment.S3_ENDPOINT.trim() } : {}),
    s3ForcePathStyle: pathStyle === 'true',
    s3BucketPhotos: required(environment, 'S3_BUCKET_PHOTOS'),
    ...(environment.SQS_ENDPOINT?.trim() ? { sqsEndpoint: environment.SQS_ENDPOINT.trim() } : {}),
    sqsQueueThumbs: required(environment, 'SQS_QUEUE_THUMBS'),
    awsRegion: environment.AWS_REGION?.trim() || 'us-east-1',
    ...(accessKeyId ? { awsAccessKeyId: accessKeyId } : {}),
    ...(secretAccessKey ? { awsSecretAccessKey: secretAccessKey } : {}),
  }
}
