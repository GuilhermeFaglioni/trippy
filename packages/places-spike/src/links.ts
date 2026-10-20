import {
  expandGoogleMapsUrl,
  GoogleMapsUrlExpansionError,
  parseGoogleMapsUrl,
} from '@trippy/google-maps-links'
import type {
  GoogleMapsUrlExpansionErrorCode,
  GoogleMapsUrlExpansionOptions,
  GoogleMapsUrlParseResult,
} from '@trippy/google-maps-links'
import type { LinkExpectation, LinkFixture } from './sample.ts'

export type LinkExpansionStatus =
  'not-needed' | 'synthetic-not-expanded' | 'not-requested' | 'resolved' | 'failed'

export interface LinkBenchmarkRow {
  id: string
  format: string
  source: LinkFixture['source']
  sourceReferenceUrl?: string
  url: string
  targetCaseId: string | null
  expected: LinkExpectation
  actual: GoogleMapsUrlParseResult
  correct: boolean | null
  fallbackApplied: boolean
  expansion: {
    status: LinkExpansionStatus
    evidence?: 'http' | 'simulated'
    finalUrl?: string
    errorCode?: GoogleMapsUrlExpansionErrorCode | 'unknown'
  }
}

export interface LinkOutcomeCounts {
  total: number
  executed: number
  correct: number
  incorrect: number
  pending: number
}

export interface LinkBenchmarkReport {
  schemaVersion: 1
  benchmark: 'Google Maps links'
  createdAt: string
  scope: string
  dataset: {
    total: number
    synthetic: number
    public: number
    byFormat: Record<string, number>
    byExpectedOutcome: Record<'coordinates' | 'query' | 'fallback', number>
  }
  parameters: {
    resolvePublicRedirects: boolean
    expansionEvidence: 'http' | 'simulated' | 'none'
  }
  summary: {
    total: number
    executed: number
    correct: number
    incorrect: number
    pending: number
    byFormat: Record<string, LinkOutcomeCounts>
    byExpectedOutcome: Record<'coordinates' | 'query' | 'fallback', LinkOutcomeCounts>
    byActualOutcome: Record<'coordinates' | 'query' | 'fallback', number>
    expansion: Record<LinkExpansionStatus, number>
  }
  results: LinkBenchmarkRow[]
}

export interface LinkBenchmarkOptions {
  resolvePublicRedirects?: boolean
  expansionOptions?: GoogleMapsUrlExpansionOptions
  expand?: (url: string, options?: GoogleMapsUrlExpansionOptions) => Promise<string>
  now?: () => Date
}

const outcomeKinds = ['coordinates', 'query', 'fallback'] as const
const expansionStatuses: readonly LinkExpansionStatus[] = [
  'not-needed',
  'synthetic-not-expanded',
  'not-requested',
  'resolved',
  'failed',
]

/** Avalia extração de dados presentes nos links sem consultar páginas ou APIs Google. */
export async function evaluateGoogleMapsLinks(
  fixtures: readonly LinkFixture[],
  options: LinkBenchmarkOptions = {},
): Promise<LinkBenchmarkReport> {
  const resolvePublicRedirects = options.resolvePublicRedirects ?? false
  const expand = options.expand ?? expandGoogleMapsUrl
  const results: LinkBenchmarkRow[] = []

  for (const fixture of fixtures) {
    let parseUrl = fixture.url
    let expansion: LinkBenchmarkRow['expansion'] = { status: 'not-needed' }
    let shouldCompare = true

    if (fixture.requiresExpansion && fixture.synthetic) {
      expansion = { status: 'synthetic-not-expanded' }
    } else if (fixture.requiresExpansion && !resolvePublicRedirects) {
      expansion = { status: 'not-requested' }
      shouldCompare = false
    } else if (fixture.requiresExpansion) {
      const evidence = options.expand ? 'simulated' : 'http'
      try {
        parseUrl = await expand(fixture.url, options.expansionOptions)
        expansion = { status: 'resolved', evidence, finalUrl: parseUrl }
      } catch (error) {
        expansion = {
          status: 'failed',
          evidence,
          errorCode: error instanceof GoogleMapsUrlExpansionError ? error.code : 'unknown',
        }
      }
    }

    const actual = parseGoogleMapsUrl(parseUrl)
    results.push({
      id: fixture.id,
      format: fixture.format,
      source: fixture.source,
      ...(fixture.sourceReferenceUrl ? { sourceReferenceUrl: fixture.sourceReferenceUrl } : {}),
      url: fixture.url,
      targetCaseId: fixture.targetCaseId,
      expected: fixture.expected,
      actual,
      correct: shouldCompare ? matchesExpectation(actual, fixture.expected) : null,
      fallbackApplied: actual.kind === 'fallback',
      expansion,
    })
  }

  const now = options.now ?? (() => new Date())
  const expansionEvidence =
    results.find((result) => result.expansion.evidence)?.expansion.evidence ?? 'none'
  return {
    schemaVersion: 1,
    benchmark: 'Google Maps links',
    createdAt: now().toISOString(),
    scope:
      'Parser de texto de URL e fallback; sem scraping, API Google, consultas Geoapify ou validação de existência do lugar.',
    dataset: {
      total: fixtures.length,
      synthetic: fixtures.filter((fixture) => fixture.synthetic).length,
      public: fixtures.filter((fixture) => !fixture.synthetic).length,
      byFormat: countBy(fixtures.map((fixture) => fixture.format)),
      byExpectedOutcome: countOutcomes(fixtures.map((fixture) => fixture.expected.kind)),
    },
    parameters: { resolvePublicRedirects, expansionEvidence },
    summary: summarize(results),
    results,
  }
}

function matchesExpectation(actual: GoogleMapsUrlParseResult, expected: LinkExpectation): boolean {
  if (actual.kind !== expected.kind) return false

  if (actual.kind === 'coordinates' && expected.kind === 'coordinates') {
    return (
      actual.source === expected.source &&
      (expected.query === undefined || actual.query === expected.query) &&
      actual.coordinates.latitude === expected.coordinates.latitude &&
      actual.coordinates.longitude === expected.coordinates.longitude
    )
  }
  if (actual.kind === 'query' && expected.kind === 'query') {
    return (
      actual.query === expected.query &&
      (expected.reason === undefined || actual.reason === expected.reason)
    )
  }
  if (actual.kind === 'fallback' && expected.kind === 'fallback') {
    return actual.reason === expected.reason
  }
  return false
}

function summarize(results: readonly LinkBenchmarkRow[]): LinkBenchmarkReport['summary'] {
  const byFormat: Record<string, LinkOutcomeCounts> = {}
  const byExpectedOutcome = emptyOutcomeCounts()
  const byActualOutcome = emptyOutcomeNumberCounts()
  const expansion = Object.fromEntries(expansionStatuses.map((status) => [status, 0])) as Record<
    LinkExpansionStatus,
    number
  >

  for (const result of results) {
    const formatCounts = (byFormat[result.format] ??= emptyOutcomeCount())
    addOutcomeCount(formatCounts, result.correct)
    addOutcomeCount(byExpectedOutcome[result.expected.kind], result.correct)
    byActualOutcome[result.actual.kind] += 1
    expansion[result.expansion.status] += 1
  }

  return {
    total: results.length,
    executed: results.filter((result) => result.correct !== null).length,
    correct: results.filter((result) => result.correct === true).length,
    incorrect: results.filter((result) => result.correct === false).length,
    pending: results.filter((result) => result.correct === null).length,
    byFormat,
    byExpectedOutcome,
    byActualOutcome,
    expansion,
  }
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function countOutcomes(
  values: readonly LinkExpectation['kind'][],
): Record<'coordinates' | 'query' | 'fallback', number> {
  const counts = emptyOutcomeNumberCounts()
  for (const value of values) counts[value] += 1
  return counts
}

function emptyOutcomeCounts(): Record<'coordinates' | 'query' | 'fallback', LinkOutcomeCounts> {
  return Object.fromEntries(outcomeKinds.map((kind) => [kind, emptyOutcomeCount()])) as Record<
    'coordinates' | 'query' | 'fallback',
    LinkOutcomeCounts
  >
}

function emptyOutcomeNumberCounts(): Record<'coordinates' | 'query' | 'fallback', number> {
  return { coordinates: 0, query: 0, fallback: 0 }
}

function emptyOutcomeCount(): LinkOutcomeCounts {
  return { total: 0, executed: 0, correct: 0, incorrect: 0, pending: 0 }
}

function addOutcomeCount(counts: LinkOutcomeCounts, correct: boolean | null): void {
  counts.total += 1
  if (correct === null) counts.pending += 1
  else if (correct) {
    counts.executed += 1
    counts.correct += 1
  } else {
    counts.executed += 1
    counts.incorrect += 1
  }
}
