import { describe, expect, it } from 'vitest'
import { evaluateGoogleMapsLinks } from './links.ts'
import { allLinkFixtures, linkFixtures, publicLinkFixtures, sampleCases } from './sample.ts'

describe('amostra do spike 18', () => {
  it('tem os tamanhos e grupos definidos pela issue', () => {
    const china = sampleCases.filter((item) => item.group === 'china')
    const beijing = china.filter((item) => item.city === 'Beijing')
    const shanghai = china.filter((item) => item.city === 'Shanghai')
    const global = sampleCases.filter((item) => item.group === 'global')
    const addresses = sampleCases.filter((item) => item.group === 'address')

    expect(china).toHaveLength(30)
    expect(beijing).toHaveLength(15)
    expect(shanghai).toHaveLength(15)
    expect(global).toHaveLength(20)
    expect(addresses).toHaveLength(10)
    expect(sampleCases).toHaveLength(60)
  })

  it('rotula cada caso antes da execução, com fonte, aliases, tolerância e precisão declarada', () => {
    expect(new Set(sampleCases.map((item) => item.id)).size).toBe(60)
    for (const item of sampleCases) {
      expect(item.sourceUrls.length).toBeGreaterThan(0)
      expect(item.coordinateToleranceMeters).toBeGreaterThan(0)
      expect(item.referencePrecision).toBe('unverified')
      expect(item.coordinates.lat).toBeGreaterThanOrEqual(-90)
      expect(item.coordinates.lat).toBeLessThanOrEqual(90)
      expect(item.coordinates.lon).toBeGreaterThanOrEqual(-180)
      expect(item.coordinates.lon).toBeLessThanOrEqual(180)
      if (item.kind === 'poi') expect(item.expectedNames.length).toBeGreaterThan(0)
      if (item.kind === 'address') expect(item.expectedAddressTokens.length).toBeGreaterThan(0)
    }
  })

  it('mantém 20 fixtures sintéticas variadas e separa referências públicas verificáveis', async () => {
    expect(linkFixtures).toHaveLength(20)
    expect(new Set(linkFixtures.map((fixture) => fixture.format)).size).toBe(20)
    expect(publicLinkFixtures).toHaveLength(4)
    expect(allLinkFixtures).toHaveLength(24)
    for (const fixture of linkFixtures) {
      expect(fixture.url.startsWith('https://')).toBe(true)
      expect(fixture.synthetic).toBe(true)
      expect(fixture.source).toBe('fixture')
      expect(fixture.expected.kind).toMatch(/^(coordinates|query|fallback)$/)
      if (fixture.targetCaseId !== null) {
        expect(sampleCases.some((item) => item.id === fixture.targetCaseId)).toBe(true)
      }
    }
    for (const fixture of publicLinkFixtures) {
      expect(fixture.synthetic).toBe(false)
      expect(fixture.source).toBe('public')
      expect(fixture.sourceReferenceUrl).toMatch(/^https:\/\//)
    }

    expect(linkFixtures.map((fixture) => fixture.targetCaseId)).toEqual([
      'cn-beijing-forbidden-city',
      'cn-beijing-tiananmen-square',
      'cn-beijing-temple-of-heaven',
      null,
      'cn-beijing-summer-palace',
      null,
      null,
      'cn-beijing-national-museum',
      'cn-shanghai-bund',
      null,
      'cn-beijing-national-stadium',
      null,
      'cn-shanghai-bund',
      'cn-shanghai-oriental-pearl',
      'cn-shanghai-jia-jia-tang-bao',
      'global-eiffel-tower',
      null,
      null,
      'global-di-fara-pizza',
      null,
    ])

    const report = await evaluateGoogleMapsLinks(linkFixtures, {
      resolvePublicRedirects: true,
      now: () => new Date('2026-10-20T00:00:00.000Z'),
    })
    expect(report.results.filter((result) => result.correct === false)).toEqual([])
    expect(report.summary).toMatchObject({
      total: 20,
      executed: 20,
      correct: 20,
      incorrect: 0,
      pending: 0,
    })
    expect(report.dataset.byExpectedOutcome).toEqual({ coordinates: 2, query: 10, fallback: 8 })
    expect(report.parameters.expansionEvidence).toBe('none')
    expect(report.summary.expansion['synthetic-not-expanded']).toBe(2)
  })
})
