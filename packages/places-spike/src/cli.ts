import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runBenchmark } from './runner.ts'
import { sampleCases } from './sample.ts'

export interface CliOptions {
  maxRequests?: number
  delayMs?: number
  timeoutMs?: number
  onlyAddresses: boolean
  caseId?: string
  output: string
  help: boolean
}

const packageDirectory = fileURLToPath(new URL('../', import.meta.url))

export function parseOptions(argumentsList: readonly string[]): CliOptions {
  const options: CliOptions = {
    onlyAddresses: false,
    output: 'results/geoapify-latest.json',
    help: false,
  }
  const argumentsWithoutSeparator =
    argumentsList[0] === '--' ? argumentsList.slice(1) : argumentsList

  for (let index = 0; index < argumentsWithoutSeparator.length; index += 1) {
    const argument = argumentsWithoutSeparator[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
      continue
    }
    if (argument === '--only-addresses') {
      options.onlyAddresses = true
      continue
    }
    if (
      argument !== '--max-requests' &&
      argument !== '--delay-ms' &&
      argument !== '--timeout-ms' &&
      argument !== '--output' &&
      argument !== '--case'
    ) {
      throw new Error(`Opção desconhecida: ${argument ?? ''}`)
    }

    const value = argumentsWithoutSeparator[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Valor ausente para ${argument}.`)
    index += 1

    if (argument === '--output') {
      options.output = value
      continue
    }
    if (argument === '--case') {
      options.caseId = value
      continue
    }
    const number = Number(value)
    if (!Number.isInteger(number)) throw new Error(`Valor inválido para ${argument}; use inteiro.`)
    if (argument === '--max-requests') options.maxRequests = number
    if (argument === '--delay-ms') options.delayMs = number
    if (argument === '--timeout-ms') options.timeoutMs = number
  }

  return options
}

export function selectCases(cases: typeof sampleCases, options: CliOptions) {
  const selected = options.caseId
    ? cases.filter((item) => item.id === options.caseId)
    : options.onlyAddresses
      ? cases.filter((item) => item.kind === 'address')
      : cases
  if (selected.length === 0)
    throw new Error(`Nenhum caso encontrado para --case ${options.caseId ?? ''}.`)
  return selected
}

function resolveOutputPath(output: string): string {
  const outputPath = resolve(packageDirectory, output)
  const fromPackage = relative(packageDirectory, outputPath)
  if (fromPackage === '..' || fromPackage.startsWith(`..${sep}`) || fromPackage.startsWith(sep)) {
    throw new Error('--output precisa apontar para dentro de packages/places-spike/.')
  }
  return outputPath
}

function printHelp(): void {
  console.log(`Benchmark Geoapify — Spike 18

Uso: pnpm --filter @trippy/places-spike benchmark -- [opções]

Opções:
  --max-requests <n>  Limite de chamadas (1–120; padrão: 120)
  --delay-ms <n>      Intervalo entre chamadas (mínimo: 200; padrão: 1100)
  --timeout-ms <n>    Timeout por chamada (500–30000; padrão: 10000)
  --only-addresses    Executa só os 10 casos de endereço
  --case <id>         Executa um caso específico (diagnóstico)
  --output <arquivo>  JSON dentro do pacote (padrão: results/geoapify-latest.json)
  --help              Exibe esta ajuda

Chave: GEOAPIFY_API_KEY no ambiente ou no .env da raiz. Links Google ficam fora do benchmark.`)
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  const apiKey = process.env.GEOAPIFY_API_KEY
  if (!apiKey) throw new Error('GEOAPIFY_API_KEY ausente. Configure o ambiente ou o arquivo .env.')

  const report = await runBenchmark({
    cases: selectCases(sampleCases, options),
    apiKey,
    ...(options.maxRequests !== undefined ? { maxRequests: options.maxRequests } : {}),
    ...(options.delayMs !== undefined ? { delayMs: options.delayMs } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  })
  const outputPath = resolveOutputPath(options.output)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  const total = report.summary.total
  console.log(`Benchmark concluído: ${report.executedRequests}/${report.plannedRequests} chamadas.`)
  console.log(
    `Erros: ${total.errors}; ausências: ${total.absences}; créditos estimados: ${total.estimatedCredits}.`,
  )
  console.log(`Relatório JSON: ${relative(packageDirectory, outputPath)}`)
  if (total.errors > 0) process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    const safeMessage = error instanceof Error ? error.message : 'Falha inesperada no benchmark.'
    console.error(`Falha no benchmark: ${safeMessage}`)
    process.exitCode = 1
  })
}
