import { expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'

const validEnvironment: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://trippy:trippy@localhost:54329/trippy',
  S3_BUCKET_PHOTOS: 'trippy-photos',
  SQS_QUEUE_THUMBS: 'trippy-thumbs',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '51025',
}

it('valida configuração obrigatória com o nome da variável ausente', () => {
  expect(() => loadConfig({ ...validEnvironment, DATABASE_URL: undefined })).toThrow(
    'Variável obrigatória não definida: DATABASE_URL.',
  )
})

it('aplica valores padrão e lê configurações locais', () => {
  expect(
    loadConfig({
      ...validEnvironment,
      PORT: '3100',
      AWS_REGION: 'us-east-2',
      S3_ENDPOINT: 'http://localhost:59000',
      S3_FORCE_PATH_STYLE: 'true',
      SQS_ENDPOINT: 'http://localhost:59324',
    }),
  ).toEqual({
    port: 3100,
    databaseUrl: validEnvironment.DATABASE_URL,
    awsRegion: 'us-east-2',
    s3Endpoint: 'http://localhost:59000',
    s3ForcePathStyle: true,
    s3BucketPhotos: 'trippy-photos',
    sqsEndpoint: 'http://localhost:59324',
    sqsQueueThumbs: 'trippy-thumbs',
    smtpHost: 'localhost',
    smtpPort: 51025,
  })
})
