import { evaluateCase, type BenchmarkCase, type CaseEvaluation } from './evaluation.ts'
import { searchGeoapify, type ProviderSearchResult } from './client.ts'
import { createRequestPlan, type PlannedRequest, type ProviderMethod } from './plan.ts'
import { linkFixtures } from './sample.ts'

export type BenchmarkSearch = (request: PlannedRequest) => Promise<ProviderSearchResult>

export interface BenchmarkRunOptions {
  cases: readonly BenchmarkCase[]
  maxRequests?: number
  delayMs?: number
  timeoutMs?: number
  search?: BenchmarkSearch
  apiKey?: string
  fetcher?: typeof fetch
  sleep?: (durationMs: number) => Promise<void>
  now?: () => Date
}

export interface BenchmarkRow {
  caseId: string
  group: BenchmarkCase['group']
  kind: BenchmarkCase['kind']
  query: string
  city: string
  expectedNames: readonly string[]
  expectedAddressTokens: readonly string[]
  referenceCoordinates: BenchmarkCase['coordinates']
  coordinateToleranceMeters: number
  referencePrecision: BenchmarkCase['referencePrecision']
  sourceUrls: readonly string[]
  placesCategory?: string
  method: ProviderMethod
  status: ProviderSearchResult['status']
  httpStatus: number | null
  errorKind?: ProviderSearchResult['errorKind']
  latencyMs: number
  resultCount: number
  estimatedCredits: number | null
  candidates: ProviderSearchResult['candidates']
  evaluation: CaseEvaluation
}

export interface AggregateMetrics {
  calls: number
  successful: number
  notFound: number
  errors: number
  validResponses: number
  absences: number
  top1Hits: number
  top1Denominator: number
  top1HitRate: number | null
  topKHits: number
  topKDenominator: number
  topKHitRate: number | null
  localAddressCompleteCount: number
  localAddressCompletenessRate: number | null
  matchedCoordinateCount: number
  coordinateWithinToleranceCount: number
  coordinateWithinToleranceRate: number | null
  missingCoordinates: number
  medianMatchedDistanceMeters: number | null
  p95MatchedDistanceMeters: number | null
  duplicateCount: number
  estimatedCredits: number
  meanLatencyMs: number | null
  medianLatencyMs: number | null
  p95LatencyMs: number | null
  maxLatencyMs: number | null
}

export interface BenchmarkReport {
  schemaVersion: 1
  provider: 'Geoapify'
  createdAt: string
  dataset: {
    cases: number
    chinaPois: number
    globalPois: number
    addresses: number
    linkFixtures: number
    linkFixturesPending: number
    referencePrecisionUnverified: number
  }
  parameters: {
    resultLimit: 5
    topK: 5
    maxRequests: number
    delayMs: number
    timeoutMs: number
  }
  plannedRequests: number
  executedRequests: number
  requestLimitReached: boolean
  summary: {
    total: AggregateMetrics
    byGroup: Record<string, AggregateMetrics>
    byMethod: Record<string, AggregateMetrics>
  }
  results: BenchmarkRow[]
}

const DEFAULT_MAX_REQUESTS = 120
const MIN_DELAY_MS = 200
const MAX_TIMEOUT_MS = 30_000

export async function runBenchmark(options: BenchmarkRunOptions): Promise<BenchmarkReport> {
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS
  const delayMs = options.delayMs ?? 1_100
  const timeoutMs = options.timeoutMs ?? 10_000
  validateRunOptions(maxRequests, delayMs, timeoutMs)

  const plan = createRequestPlan(options.cases)
  const selectedPlan = plan.slice(0, maxRequests)
  const search = options.search ?? createLiveSearch(options)
  const sleep =
    options.sleep ??
    ((durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)))
  const now = options.now ?? (() => new Date())
  const rows: BenchmarkRow[] = []

  for (const [index, request] of selectedPlan.entries()) {
    if (index > 0 && delayMs > 0) await sleep(delayMs)
    const result = await search(request)
    rows.push(toBenchmarkRow(request, result))
  }

  return {
    schemaVersion: 1,
    provider: 'Geoapify',
    createdAt: now().toISOString(),
    dataset: {
      cases: options.cases.length,
      chinaPois: options.cases.filter((item) => item.group === 'china' && item.kind === 'poi')
        .length,
      globalPois: options.cases.filter((item) => item.group === 'global' && item.kind === 'poi')
        .length,
      addresses: options.cases.filter((item) => item.kind === 'address').length,
      linkFixtures: linkFixtures.length,
      linkFixturesPending: linkFixtures.length,
      referencePrecisionUnverified: options.cases.filter(
        (item) => item.referencePrecision === 'unverified',
      ).length,
    },
    parameters: { resultLimit: 5, topK: 5, maxRequests, delayMs, timeoutMs },
    plannedRequests: plan.length,
    executedRequests: rows.length,
    requestLimitReached: plan.length > rows.length,
    summary: summarize(rows),
    results: rows,
  }
}

function createLiveSearch(options: BenchmarkRunOptions): BenchmarkSearch {
  if (!options.apiKey)
    throw new Error('GEOAPIFY_API_KEY ausente. Configure o ambiente ou o arquivo .env.')
  return (request) =>
    searchGeoapify(request, options.apiKey!, {
      timeoutMs: options.timeoutMs ?? 10_000,
      ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    })
}

function validateRunOptions(maxRequests: number, delayMs: number, timeoutMs: number): void {
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > DEFAULT_MAX_REQUESTS) {
    throw new Error(
      `--max-requests deve ser um inteiro entre 1 e o máximo de ${DEFAULT_MAX_REQUESTS}.`,
    )
  }
  if (!Number.isInteger(delayMs) || delayMs < MIN_DELAY_MS) {
    throw new Error(`--delay-ms deve ser um inteiro de pelo menos ${MIN_DELAY_MS} ms.`)
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`--timeout-ms deve ser um inteiro entre 500 e ${MAX_TIMEOUT_MS} ms.`)
  }
}

function toBenchmarkRow(request: PlannedRequest, result: ProviderSearchResult): BenchmarkRow {
  return {
    caseId: request.caseId,
    group: request.benchmarkCase.group,
    kind: request.benchmarkCase.kind,
    query: request.benchmarkCase.query,
    city: request.benchmarkCase.city,
    expectedNames: request.benchmarkCase.expectedNames,
    expectedAddressTokens: request.benchmarkCase.expectedAddressTokens,
    referenceCoordinates: request.benchmarkCase.coordinates,
    coordinateToleranceMeters: request.benchmarkCase.coordinateToleranceMeters,
    referencePrecision: request.benchmarkCase.referencePrecision,
    sourceUrls: request.benchmarkCase.sourceUrls,
    ...(request.benchmarkCase.placesCategory
      ? { placesCategory: request.benchmarkCase.placesCategory }
      : {}),
    method: request.method,
    status: result.status,
    httpStatus: result.httpStatus,
    ...(result.errorKind ? { errorKind: result.errorKind } : {}),
    latencyMs: result.latencyMs,
    resultCount: result.candidates.length,
    estimatedCredits: result.estimatedCredits,
    candidates: result.candidates,
    evaluation: evaluateCase(request.benchmarkCase, result.candidates),
  }
}

function summarize(rows: readonly BenchmarkRow[]): BenchmarkReport['summary'] {
  const byGroup: Record<string, AggregateMetrics> = {}
  const byMethod: Record<string, AggregateMetrics> = {}

  for (const group of ['china', 'global', 'address'] as const) {
    byGroup[group] = aggregate(rows.filter((row) => row.group === group))
  }
  for (const method of ['geocoding', 'places'] as const) {
    byMethod[method] = aggregate(rows.filter((row) => row.method === method))
  }

  return { total: aggregate(rows), byGroup, byMethod }
}

function aggregate(rows: readonly BenchmarkRow[]): AggregateMetrics {
  const validRows = rows.filter((row) => row.status !== 'error')
  const successfulRows = rows.filter((row) => row.status === 'success')
  const notFound = rows.filter((row) => row.status === 'not-found').length
  const errors = rows.filter((row) => row.status === 'error').length
  const top1Hits = validRows.filter((row) => row.evaluation.top1Hit).length
  const topKHits = validRows.filter((row) => row.evaluation.topKHit).length
  const matchedRows = validRows.filter((row) => row.evaluation.matchedRank !== null)
  const matchedDistances = matchedRows
    .map((row) => row.evaluation.matchedDistanceMeters)
    .filter((distance): distance is number => distance !== null)
  const latencies = rows.map((row) => row.latencyMs)
  const localAddressCompleteCount = validRows.filter(
    (row) => row.evaluation.localAddressComplete,
  ).length
  const coordinateWithinToleranceCount = matchedRows.filter(
    (row) => row.evaluation.coordinateQuality === 'within-tolerance',
  ).length
  const estimatedCredits = rows.reduce((sum, row) => sum + (row.estimatedCredits ?? 0), 0)

  return {
    calls: rows.length,
    successful: successfulRows.length,
    notFound,
    errors,
    validResponses: validRows.length,
    absences: notFound,
    top1Hits,
    top1Denominator: validRows.length,
    top1HitRate: ratio(top1Hits, validRows.length),
    topKHits,
    topKDenominator: validRows.length,
    topKHitRate: ratio(topKHits, validRows.length),
    localAddressCompleteCount,
    localAddressCompletenessRate: ratio(localAddressCompleteCount, validRows.length),
    matchedCoordinateCount: matchedRows.length,
    coordinateWithinToleranceCount,
    coordinateWithinToleranceRate: ratio(coordinateWithinToleranceCount, matchedRows.length),
    missingCoordinates: matchedRows.filter(
      (row) => row.evaluation.coordinateQuality === 'missing-coordinate',
    ).length,
    medianMatchedDistanceMeters: quantile(matchedDistances, 0.5),
    p95MatchedDistanceMeters: quantile(matchedDistances, 0.95),
    duplicateCount: validRows.reduce((sum, row) => sum + row.evaluation.duplicateCount, 0),
    estimatedCredits,
    meanLatencyMs:
      latencies.length === 0
        ? null
        : round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    medianLatencyMs: quantile(latencies, 0.5),
    p95LatencyMs: quantile(latencies, 0.95),
    maxLatencyMs: latencies.length === 0 ? null : Math.max(...latencies),
  }
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : round(numerator / denominator)
}

function quantile(values: readonly number[], percentile: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.ceil(percentile * sorted.length) - 1
  return sorted[Math.max(0, index)] ?? null
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}
