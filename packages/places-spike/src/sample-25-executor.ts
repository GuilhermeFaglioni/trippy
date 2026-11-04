import type { ProviderSearchResult } from './client.ts'
import {
  type BenchmarkCase,
  type BenchmarkGroup,
  type CaseEvaluation,
  evaluateCase,
} from './evaluation.ts'
import type { BenchmarkSearch } from './runner.ts'
import {
  createSample25DryRunPlan,
  type Sample25DryRunPlan,
  sample25Languages,
  type Sample25Language,
} from './sample-25-plan.ts'
import type { PlannedRequest } from './plan.ts'
import { assertNoGoogleLeak } from './sample-25-sanitize.ts'
import type { Sample25, Sample25Case, Sample25Segment } from './sample-25.ts'

export interface Sample25Budget {
  maxRequests: number
}

export interface RunSample25Options {
  mode: 'dry-run' | 'real'
  sample: Sample25
  search?: BenchmarkSearch
  budget?: Sample25Budget
}

export interface Sample25Row {
  caseId: string
  segment: Sample25Segment
  language: Sample25Language
  status: ProviderSearchResult['status']
  evaluation: CaseEvaluation | null
}

export interface Sample25Metrics {
  rows: number
  errors: number
  top1HitRate: number | null
  topKHitRate: number | null
  localAddressCompletenessRate: number | null
  coordinateWithinToleranceRate: number | null
  absences: number
  duplicateCount: number
}

export interface Sample25Report {
  mode: 'dry-run' | 'real'
  plan: Sample25DryRunPlan | null
  providerCalls: number
  estimatedCredits: number
  costPerTouch: number | null
  stoppedByBudget: boolean
  metrics: Sample25Metrics | null
  bySegment: Partial<Record<Sample25Segment, Sample25Metrics>> | null
  rows: Sample25Row[]
}

export async function runSample25(options: RunSample25Options): Promise<Sample25Report> {
  if (options.mode === 'dry-run') {
    return {
      mode: 'dry-run',
      plan: createSample25DryRunPlan(options.sample),
      providerCalls: 0,
      estimatedCredits: 0,
      costPerTouch: null,
      stoppedByBudget: false,
      metrics: null,
      bySegment: null,
      rows: [],
    }
  }

  const { budget, search } = options
  if (!budget) throw new Error('Modo real exige orçamento explícito (budget.maxRequests).')
  if (!Number.isInteger(budget.maxRequests) || budget.maxRequests < 0) {
    throw new Error('Orçamento inválido: maxRequests deve ser inteiro não negativo.')
  }
  if (!search) throw new Error('Modo real exige função de busca (search).')

  let providerCalls = 0
  let estimatedCredits = 0
  let stoppedByBudget = false

  const dispatch = async (request: PlannedRequest): Promise<ProviderSearchResult | null> => {
    if (providerCalls >= budget.maxRequests) {
      stoppedByBudget = true
      return null
    }
    providerCalls += 1
    const result = await search(request)
    // Resultado de erro não tem estimativa de créditos; a chamada ainda conta em providerCalls.
    estimatedCredits += result.estimatedCredits ?? 0
    return result
  }

  const rows: Sample25Row[] = []
  const verifiedCases = options.sample.cases.filter(
    (item) => item.verification.status === 'verified',
  )

  outer: for (const sampleCase of verifiedCases) {
    for (const language of sample25Languages) {
      const benchmarkCase = toBenchmarkCase(sampleCase, language)
      const primary = await dispatch({
        caseId: sampleCase.id,
        method: 'geocoding',
        benchmarkCase,
      })
      if (primary === null) break outer

      let chosen = primary
      if (benchmarkCase.kind === 'poi' && !evaluateCase(benchmarkCase, primary.candidates).topKHit) {
        const secondary = await dispatch({
          caseId: sampleCase.id,
          method: 'places',
          benchmarkCase,
        })
        if (secondary === null) break outer
        chosen = secondary
      }

      rows.push({
        caseId: sampleCase.id,
        segment: sampleCase.segment,
        language,
        status: chosen.status,
        evaluation:
          chosen.status === 'error' ? null : evaluateCase(benchmarkCase, chosen.candidates),
      })
    }
  }

  const bySegment: Partial<Record<Sample25Segment, Sample25Metrics>> = {}
  for (const segment of new Set(rows.map((row) => row.segment))) {
    bySegment[segment] = summarize(rows.filter((row) => row.segment === segment))
  }

  const report: Sample25Report = {
    mode: 'real',
    plan: null,
    providerCalls,
    estimatedCredits,
    costPerTouch: providerCalls === 0 ? null : round(estimatedCredits / providerCalls),
    stoppedByBudget,
    metrics: summarize(rows),
    bySegment,
    rows,
  }
  assertNoGoogleLeak(report)
  return report
}

function toBenchmarkCase(item: Sample25Case, language: Sample25Language): BenchmarkCase {
  return {
    id: item.id,
    group: groupOf(item.segment),
    kind: item.segment === 'endereco' ? 'address' : 'poi',
    query: item.queries[language],
    language,
    city: item.city,
    countryCode: item.countryCode,
    expectedNames: item.acceptedNames,
    expectedAddressTokens: item.expectedLocalAddressTokens,
    coordinates: item.referenceCoordinate.wgs84,
    coordinateToleranceMeters: item.toleranceMeters,
    // O caso não declara precisão de referência; não afirmamos nenhuma.
    referencePrecision: 'unverified',
    sourceUrls: item.references.map((reference) => reference.url),
  }
}

function groupOf(segment: Sample25Segment): BenchmarkGroup {
  if (segment.startsWith('china')) return 'china'
  if (segment.startsWith('global')) return 'global'
  return 'address'
}

function summarize(rows: readonly Sample25Row[]): Sample25Metrics {
  const evaluated = rows.flatMap((row) => (row.evaluation ? [row.evaluation] : []))
  const share = (pick: (evaluation: CaseEvaluation) => boolean): number | null =>
    evaluated.length === 0 ? null : round(evaluated.filter(pick).length / evaluated.length)

  return {
    rows: rows.length,
    errors: rows.length - evaluated.length,
    top1HitRate: share((evaluation) => evaluation.top1Hit),
    topKHitRate: share((evaluation) => evaluation.topKHit),
    localAddressCompletenessRate: share((evaluation) => evaluation.localAddressComplete),
    coordinateWithinToleranceRate: share(
      (evaluation) => evaluation.coordinateQuality === 'within-tolerance',
    ),
    absences: rows.filter((row) => row.status === 'not-found').length,
    duplicateCount: evaluated.reduce((total, evaluation) => total + evaluation.duplicateCount, 0),
  }
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}
