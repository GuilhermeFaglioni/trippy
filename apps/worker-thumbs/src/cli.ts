import pg from 'pg'
import { PostgresPhotoStore, S3PhotoStorage } from '@trippy/adapters/photos'
import { loadThumbWorkerConfig } from './config.ts'
import { createThumbSqsClient, resolveThumbQueueUrl, ThumbWorker } from './worker.ts'

async function main(): Promise<void> {
  const config = loadThumbWorkerConfig()
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3 })
  const storage = new S3PhotoStorage({
    bucket: config.s3BucketPhotos,
    region: config.awsRegion,
    forcePathStyle: config.s3ForcePathStyle,
    ...(config.s3Endpoint ? { endpoint: config.s3Endpoint } : {}),
    ...(config.awsAccessKeyId ? { accessKeyId: config.awsAccessKeyId } : {}),
    ...(config.awsSecretAccessKey ? { secretAccessKey: config.awsSecretAccessKey } : {}),
  })
  const queueClient = createThumbSqsClient(config)
  let worker: ThumbWorker | undefined
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    const queueUrl = await resolveThumbQueueUrl(queueClient, config.sqsQueueThumbs)
    worker = new ThumbWorker(pool, new PostgresPhotoStore(pool), storage, config, queueUrl)
    if (process.argv.includes('--once')) {
      console.log(JSON.stringify(await worker.runOnce()))
      return
    }
    await worker.run(controller.signal)
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    worker?.close()
    queueClient.destroy()
    storage.close()
    await pool.end()
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha inesperada no worker de miniaturas')
  process.exitCode = 1
}
