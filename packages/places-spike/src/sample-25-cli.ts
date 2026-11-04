import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runSample25 } from './sample-25-executor.ts'
import { sample25 } from './sample-25.ts'

export interface Sample25CliOptions {
  mode: 'dry-run'
}

export function parseSample25Options(args: readonly string[]): Sample25CliOptions {
  for (const arg of args) {
    // `pnpm <script> -- <args>` repassa o separador; ele não é uma opção.
    if (arg === '--') continue
    if (arg === '--real') {
      throw new Error(
        'Execução real (--real) está bloqueada até a aprovação do orçamento na #48.',
      )
    }
    throw new Error(`Opção desconhecida: ${arg}`)
  }
  return { mode: 'dry-run' }
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  parseSample25Options(args)
  const report = await runSample25({ mode: 'dry-run', sample: sample25 })
  console.log(JSON.stringify(report, null, 2))
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Falha no benchmark: ${message}`)
    process.exitCode = 1
  })
}
