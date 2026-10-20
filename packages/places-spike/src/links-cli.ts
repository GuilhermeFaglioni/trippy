import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { evaluateGoogleMapsLinks } from './links.ts'
import { allLinkFixtures } from './sample.ts'

export interface LinkCliOptions {
  resolvePublicRedirects: boolean
  timeoutMs: number
  maxRedirects: number
  output: string
  help: boolean
}

const packageDirectory = fileURLToPath(new URL('../', import.meta.url))

export function parseLinkOptions(argumentsList: readonly string[]): LinkCliOptions {
  const options: LinkCliOptions = {
    resolvePublicRedirects: false,
    timeoutMs: 5_000,
    maxRedirects: 5,
    output: 'results/google-maps-links-latest.json',
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
    if (argument === '--resolve-public-redirects') {
      options.resolvePublicRedirects = true
      continue
    }
    if (argument !== '--timeout-ms' && argument !== '--max-redirects' && argument !== '--output') {
      throw new Error(`Opção desconhecida: ${argument ?? ''}`)
    }

    const value = argumentsWithoutSeparator[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Valor ausente para ${argument}.`)
    index += 1

    if (argument === '--output') {
      options.output = value
      continue
    }

    const number = Number(value)
    if (!Number.isInteger(number)) throw new Error(`Valor inválido para ${argument}; use inteiro.`)
    if (argument === '--timeout-ms') {
      if (number < 1 || number > 30_000) {
        throw new Error('--timeout-ms deve ser inteiro entre 1 e 30000.')
      }
      options.timeoutMs = number
    } else {
      if (number < 0 || number > 5) throw new Error('--max-redirects deve estar entre 0 e 5.')
      options.maxRedirects = number
    }
  }

  return options
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
  console.log(`Benchmark dos links Google Maps — Spike 18

Requer Node >=22.

Uso: pnpm --filter @trippy/places-spike benchmark:links -- [opções]

Opções:
  --resolve-public-redirects  Expande links públicos curtos por HTTPS seguro
  --timeout-ms <n>            Timeout por salto (1–30000; padrão: 5000)
  --max-redirects <n>         Limite de redirects (0–5; padrão: 5)
  --output <arquivo>          JSON dentro do pacote (padrão: results/google-maps-links-latest.json)
  --help                      Exibe esta ajuda

Sem a opção de expansão, links públicos curtos ficam pendentes. Fixtures sintéticas nunca fazem rede.
O benchmark lê apenas URLs; não abre páginas, não usa API Google e não chama Geoapify.`)
}

async function main(): Promise<void> {
  const options = parseLinkOptions(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const report = await evaluateGoogleMapsLinks(allLinkFixtures, {
    resolvePublicRedirects: options.resolvePublicRedirects,
    expansionOptions: { timeoutMs: options.timeoutMs, maxRedirects: options.maxRedirects },
  })
  const outputPath = resolveOutputPath(options.output)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(
    `Links: ${report.summary.total}; corretos: ${report.summary.correct}; incorretos: ${report.summary.incorrect}; pendentes: ${report.summary.pending}.`,
  )
  console.log(
    `Esperados: ${JSON.stringify(report.dataset.byExpectedOutcome)}; expansões: ${JSON.stringify(report.summary.expansion)}.`,
  )
  console.log(`Relatório JSON: ${relative(packageDirectory, outputPath)}`)
  if (
    report.summary.incorrect > 0 ||
    (options.resolvePublicRedirects && report.summary.pending > 0)
  ) {
    process.exitCode = 1
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    const safeMessage = error instanceof Error ? error.message : 'Falha inesperada no benchmark.'
    console.error(`Falha no benchmark de links: ${safeMessage}`)
    process.exitCode = 1
  })
}
