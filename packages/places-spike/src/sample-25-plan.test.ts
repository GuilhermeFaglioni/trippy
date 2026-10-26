import { describe, expect, it } from 'vitest'
import { createSample25DryRunPlan } from './sample-25-plan.ts'
import { measuredSample25, sample25 } from './sample-25.ts'

describe('plano offline da amostra #25', () => {
  it('planeja as consultas primárias nos três idiomas só para casos verificados', () => {
    const plan = createSample25DryRunPlan(sample25)

    expect(measuredSample25).toHaveLength(47)
    expect(plan.dataset).toEqual({ totalCases: 60, verifiedCases: 47, excludedUnverified: 13 })
    expect(plan.primaryRequests).toHaveLength(47 * 3)
    expect(plan.primaryRequestsByLanguage).toEqual({ pt: 47, en: 47, local: 47 })
    expect(plan.primaryRequests.find((request) => request.language === 'pt')?.query).toBeTruthy()
    expect(
      plan.primaryRequests.some((request) =>
        measuredSample25.some(
          (item) => item.id === request.caseId && item.queries[request.language] !== request.query,
        ),
      ),
    ).toBe(false)
  })

  it('descreve Places como tentativa condicional sem simular resposta ou métrica', () => {
    const plan = createSample25DryRunPlan(sample25)

    expect(plan.secondaryAttempt).toEqual({
      method: 'places',
      condition: 'primary-empty-or-human-rejection',
      dispatchedInDryRun: false,
      possibleScenarios: 47 * 3,
    })
    expect(plan.providerCalls).toBe(0)
    expect(plan.metrics).toBeNull()
  })

  it('mantém contagens planejadas por segmento para auditar cobertura', () => {
    const plan = createSample25DryRunPlan(sample25)

    expect(
      Object.values(plan.primaryRequestsBySegment).reduce((total, value) => total + value, 0),
    ).toBe(plan.primaryRequests.length)
    expect(plan.primaryRequestsBySegment['china-atracao']).toBeGreaterThanOrEqual(10 * 3)
    expect(plan.primaryRequests.every((request) => request.method === 'geocoding')).toBe(true)
  })
})
