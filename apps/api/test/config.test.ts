import { expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'

const validEnvironment: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://trippy:trippy@localhost:54329/trippy',
  PLACES_CANDIDATE_SECRET: 'segredo-de-candidato-de-teste-com-entropia-suficiente',
  S3_BUCKET_PHOTOS: 'trippy-photos',
  SQS_QUEUE_THUMBS: 'trippy-thumbs',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '51025',
  AUTH_CODE_SECRET: 'segredo-de-teste-com-entropia-suficiente',
  AUTH_DEV_JWT_PRIVATE_KEY: 'chave-jwk-de-teste',
}

it('valida configuração obrigatória com o nome da variável ausente', () => {
  expect(() => loadConfig({ ...validEnvironment, DATABASE_URL: undefined })).toThrow(
    'Variável obrigatória não definida: DATABASE_URL.',
  )
})

it('exige o segredo usado para validar candidatos de lugar', () => {
  expect(() => loadConfig({ ...validEnvironment, PLACES_CANDIDATE_SECRET: undefined })).toThrow(
    'Variável obrigatória não definida: PLACES_CANDIDATE_SECRET.',
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
    host: '127.0.0.1',
    appEnv: 'development',
    authMode: 'dev',
    authIssuer: 'trippy-dev-auth',
    authAudience: 'trippy-dev',
    authCodeSecret: validEnvironment.AUTH_CODE_SECRET,
    authDevJwtPrivateKey: validEnvironment.AUTH_DEV_JWT_PRIVATE_KEY,
    databaseUrl: validEnvironment.DATABASE_URL,
    placesCandidateSecret: validEnvironment.PLACES_CANDIDATE_SECRET,
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

it('permite configurar o endereço de escuta com HOST', () => {
  expect(loadConfig({ ...validEnvironment, HOST: '0.0.0.0' }).host).toBe('0.0.0.0')
})

it('recusa AUTH_MODE=dev quando APP_ENV=production', () => {
  expect(() =>
    loadConfig({ ...validEnvironment, APP_ENV: 'production', AUTH_MODE: 'dev' }),
  ).toThrow('AUTH_MODE=dev não pode ser usado com APP_ENV=production.')
})

it('exige issuer, audience e JWKS quando configurada para Cognito', () => {
  const config = loadConfig({
    ...validEnvironment,
    APP_ENV: 'production',
    AUTH_MODE: 'cognito',
    AUTH_ISSUER: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool',
    AUTH_AUDIENCE: 'trippy-production-client',
    AUTH_JWKS_URL:
      'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool/.well-known/jwks.json',
  })

  expect(config).toMatchObject({
    appEnv: 'production',
    authMode: 'cognito',
    authIssuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool',
    authAudience: 'trippy-production-client',
    authJwksUrl: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool/.well-known/jwks.json',
  })
})
