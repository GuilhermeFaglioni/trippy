import { describe, expect, it, vi } from 'vitest'
import { GoogleMapsUrlExpansionError } from '@trippy/google-maps-links'
import { parseLinkOptions } from './links-cli.ts'
import { evaluateGoogleMapsLinks } from './links.ts'
import { publicLinkFixtures } from './sample.ts'
import type { LinkFixture } from './sample.ts'

const publicShortLink = publicLinkFixtures.find(
  (fixture) => fixture.format === 'public-short-place',
)
if (!publicShortLink) throw new Error('Fixture pública curta ausente.')

describe('benchmark de links Google Maps', () => {
  it('valida opções do CLI e mantém expansão HTTP explicitamente opt-in', () => {
    expect(parseLinkOptions([])).toMatchObject({
      resolvePublicRedirects: false,
      timeoutMs: 5_000,
      maxRedirects: 5,
    })
    expect(
      parseLinkOptions([
        '--resolve-public-redirects',
        '--timeout-ms',
        '10000',
        '--max-redirects',
        '2',
        '--output',
        'results/links.json',
      ]),
    ).toMatchObject({ resolvePublicRedirects: true, timeoutMs: 10_000, maxRedirects: 2 })
    expect(() => parseLinkOptions(['--max-redirects', '6'])).toThrow(/entre 0 e 5/)
  })

  it('extrai texto da URL e compara com o resultado esperado sem acessar a rede', async () => {
    const fixture = {
      id: 'direct-query',
      format: 'query-api',
      url: 'https://www.google.com/maps/search/?api=1&query=Eiffel+Tower',
      targetCaseId: null,
      synthetic: true,
      source: 'fixture',
      requiresExpansion: false,
      expected: { kind: 'query', query: 'Eiffel Tower', reason: 'query' },
    } satisfies LinkFixture
    const expand = vi.fn()

    const report = await evaluateGoogleMapsLinks([fixture], {
      resolvePublicRedirects: true,
      expand,
    })

    expect(report.summary.executed).toBe(1)
    expect(report.summary.correct).toBe(1)
    expect(report.results[0]?.actual).toEqual(fixture.expected)
    expect(report.results[0]?.expansion.status).toBe('not-needed')
    expect(expand).not.toHaveBeenCalled()
  })

  it('registra erro de expansão e usa fallback seguro no link original', async () => {
    const expand = vi.fn(async (url: string) => {
      expect(url).toBe(publicShortLink.url)
      throw new GoogleMapsUrlExpansionError('timeout', 'Timeout após 5000 ms')
    })

    const report = await evaluateGoogleMapsLinks([publicShortLink], {
      resolvePublicRedirects: true,
      expand,
    })

    expect(report.results[0]?.expansion).toEqual({
      status: 'failed',
      evidence: 'simulated',
      errorCode: 'timeout',
    })
    expect(report.results[0]?.actual).toEqual({ kind: 'fallback', reason: 'unsupported' })
    expect(report.results[0]?.fallbackApplied).toBe(true)
    expect(report.results[0]?.correct).toBe(false)
  })
})
