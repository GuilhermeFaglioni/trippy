import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { evaluateGoogleMapsLinks } from './links.ts'
import { allLinkFixtures } from './sample.ts'

const execFileAsync = promisify(execFile)
const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), 'links-cli.ts')

describe('integração parser Google Maps → benchmark de lugares', () => {
  it('avalia links rotulados e distingue redirect simulado de evidência HTTP', async () => {
    const shortLink = allLinkFixtures.find((fixture) => fixture.format === 'public-short-place')
    if (!shortLink) throw new Error('Fixture pública curta ausente.')
    const expand = vi.fn(async (url: string) => {
      expect(url).toBe(shortLink.url)
      return 'https://www.google.com/maps/place/Eiffel+Tower/data=!3m1!3d48.8583701!4d2.2944813'
    })

    const report = await evaluateGoogleMapsLinks(allLinkFixtures, {
      resolvePublicRedirects: true,
      expand,
      now: () => new Date('2026-10-20T00:00:00.000Z'),
    })

    expect(report.dataset).toMatchObject({ total: 24, synthetic: 20, public: 4 })
    expect(report.summary).toMatchObject({
      total: 24,
      executed: 24,
      correct: 24,
      incorrect: 0,
      pending: 0,
    })
    expect(report.parameters.expansionEvidence).toBe('simulated')
    expect(report.results.find((row) => row.id === shortLink.id)?.expansion).toMatchObject({
      status: 'resolved',
      evidence: 'simulated',
    })
    expect(report.results.find((row) => row.id === 'google-maps-link-04')?.fallbackApplied).toBe(
      true,
    )
    expect(expand).toHaveBeenCalledTimes(1)
  })

  it('executa o CLI direto no Node 22 sem loader externo', async () => {
    const result = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      '--experimental-transform-types',
      cliPath,
      '--help',
    ])

    expect(result.stdout).toContain('Node >=22')
    expect(result.stdout).toContain('--resolve-public-redirects')
  })
})
