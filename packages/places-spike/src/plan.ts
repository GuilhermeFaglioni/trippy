import type { BenchmarkCase } from './evaluation.ts'

export type ProviderMethod = 'geocoding' | 'places'

export interface PlannedRequest {
  caseId: string
  method: ProviderMethod
  benchmarkCase: BenchmarkCase
}

export function createRequestPlan(cases: readonly BenchmarkCase[]): PlannedRequest[] {
  return cases.flatMap((benchmarkCase) =>
    benchmarkCase.kind === 'poi'
      ? [
          { caseId: benchmarkCase.id, method: 'geocoding' as const, benchmarkCase },
          { caseId: benchmarkCase.id, method: 'places' as const, benchmarkCase },
        ]
      : [{ caseId: benchmarkCase.id, method: 'geocoding' as const, benchmarkCase }],
  )
}
