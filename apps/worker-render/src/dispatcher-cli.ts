import pg from 'pg'
import { loadDispatcherConfig } from './config.ts'
import { DockerRuntime } from './docker-runtime.ts'
import { dispatchOne, runDispatcher } from './dispatcher.ts'
import { createQueueClient } from './queue.ts'

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
    if (process.argv.includes('--once')) {
      const outcome = await dispatchOne(pool, sqs, runtime, config)
      console.log(JSON.stringify(outcome))
      return
    }
    await runDispatcher(pool, sqs, runtime, config, controller.signal)
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
  console.error(error instanceof Error ? error.message : 'Falha inesperada no dispatcher')
  process.exitCode = 1
}
