import { sample25Segments, type Sample25, type Sample25Segment } from './sample-25.ts'

export const sample25Languages = ['pt', 'en', 'local'] as const

export type Sample25Language = (typeof sample25Languages)[number]

export interface Sample25DryRunRequest {
  caseId: string
  segment: Sample25Segment
  city: string
  countryCode: string
  language: Sample25Language
  query: string
  method: 'geocoding'
}

export interface Sample25DryRunPlan {
  mode: 'offline-dry-run'
  dataset: {
    totalCases: number
    verifiedCases: number
    excludedUnverified: number
  }
  primaryRequests: Sample25DryRunRequest[]
  primaryRequestsByLanguage: Record<Sample25Language, number>
  primaryRequestsBySegment: Record<Sample25Segment, number>
  secondaryAttempt: {
    method: 'places'
    condition: 'primary-empty-or-human-rejection'
    dispatchedInDryRun: false
    possibleScenarios: number
  }
  providerCalls: 0
  metrics: null
  note: string
}

export function createSample25DryRunPlan(sample: Sample25): Sample25DryRunPlan {
  const measuredCases = sample.cases.filter((item) => item.verification.status === 'verified')
  const primaryRequests: Sample25DryRunRequest[] = measuredCases.flatMap((item) =>
    sample25Languages.map((language) => ({
      caseId: item.id,
      segment: item.segment,
      city: item.city,
      countryCode: item.countryCode,
      language,
      query: item.queries[language],
      method: 'geocoding',
    })),
  )

  const primaryRequestsByLanguage: Record<Sample25Language, number> = {
    pt: 0,
    en: 0,
    local: 0,
  }
  const primaryRequestsBySegment = Object.fromEntries(
    sample25Segments.map((segment) => [segment, 0]),
  ) as Record<Sample25Segment, number>
  for (const request of primaryRequests) {
    primaryRequestsByLanguage[request.language] += 1
    primaryRequestsBySegment[request.segment] += 1
  }

  return {
    mode: 'offline-dry-run',
    dataset: {
      totalCases: sample.cases.length,
      verifiedCases: measuredCases.length,
      excludedUnverified: sample.cases.length - measuredCases.length,
    },
    primaryRequests,
    primaryRequestsByLanguage,
    primaryRequestsBySegment,
    secondaryAttempt: {
      method: 'places',
      condition: 'primary-empty-or-human-rejection',
      dispatchedInDryRun: false,
      possibleScenarios: primaryRequests.length,
    },
    providerCalls: 0,
    metrics: null,
    note: 'Plano offline; não executa fornecedores e não mede top-1/top-5, latência, erros ou créditos.',
  }
}
