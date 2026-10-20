import pg from 'pg'
import { loadDispatcherConfig } from './config.ts'
import { DockerRuntime } from './docker-runtime.ts'
import { createQueueClient } from './queue.ts'
import { reconcileCycle, runReconciler } from './reconciler.ts'

async function main(): Promise<void> {
  const config = loadDispatcherConfig()
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 })
  const sqs = createQueueClient(config)
  const runtime = new DockerRuntime(config)
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  try {
    if (process.argv.includes('--watch')) {
      await runReconciler(pool, sqs, runtime, config, controller.signal)
      return
    }
    console.log(JSON.stringify(await reconcileCycle(pool, sqs, runtime, config)))
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    sqs.destroy()
    await pool.end()
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha inesperada na reconciliação')
  process.exitCode = 1
}
