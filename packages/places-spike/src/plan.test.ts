import { describe, expect, it } from 'vitest'
import { createRequestPlan } from './plan.ts'
import { linkFixtures, sampleCases } from './sample.ts'

describe('createRequestPlan', () => {
  it('planeja geocoding e Places para POIs e apenas geocoding para endereços', () => {
    const plan = createRequestPlan(sampleCases)

    expect(plan).toHaveLength(110)
    expect(plan.filter((request) => request.method === 'geocoding')).toHaveLength(60)
    expect(plan.filter((request) => request.method === 'places')).toHaveLength(50)
    expect(plan.some((request) => request.caseId.includes('google-maps-link'))).toBe(false)
    expect(linkFixtures).toHaveLength(20)
  })

  it('preserva ordem estável por caso, com Geocoding antes de Places', () => {
    const plan = createRequestPlan(sampleCases.slice(0, 2))

    expect(plan.map((request) => `${request.caseId}:${request.method}`)).toEqual([
      'cn-beijing-forbidden-city:geocoding',
      'cn-beijing-forbidden-city:places',
      'cn-beijing-tiananmen-square:geocoding',
      'cn-beijing-tiananmen-square:places',
    ])
  })
})
