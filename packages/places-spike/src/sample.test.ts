import { describe, expect, it } from 'vitest'
import { linkFixtures, sampleCases } from './sample.ts'

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

  it('mantém 20 links como fixtures rotuladas, sem pedir expansão ou chamadas de rede', () => {
    expect(linkFixtures).toHaveLength(20)
    expect(new Set(linkFixtures.map((fixture) => fixture.format)).size).toBe(20)
    for (const fixture of linkFixtures) {
      expect(fixture.url.startsWith('https://')).toBe(true)
      expect(fixture.synthetic).toBe(true)
      if (fixture.targetCaseId !== null) {
        expect(sampleCases.some((item) => item.id === fixture.targetCaseId)).toBe(true)
      }
    }

    expect(linkFixtures.map((fixture) => fixture.targetCaseId)).toEqual([
      'cn-beijing-forbidden-city',
      'cn-beijing-tiananmen-square',
      'cn-beijing-temple-of-heaven',
      'cn-beijing-summer-palace',
      'cn-beijing-summer-palace',
      null,
      null,
      'cn-beijing-national-museum',
      'cn-shanghai-bund',
      'cn-beijing-yonghe-temple',
      'cn-beijing-national-stadium',
      null,
      'cn-shanghai-bund',
      'cn-shanghai-oriental-pearl',
      'cn-shanghai-jia-jia-tang-bao',
      'global-eiffel-tower',
      'global-dishoom-shoreditch',
      'global-russ-and-daughters-cafe',
      'global-di-fara-pizza',
      null,
    ])
  })
})
