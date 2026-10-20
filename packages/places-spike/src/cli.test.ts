import { describe, expect, it } from 'vitest'
import { parseOptions, selectCases } from './cli.ts'
import { sampleCases } from './sample.ts'

describe('opções do CLI', () => {
  it('permite rerodar apenas endereços para diagnóstico do benchmark', () => {
    const options = parseOptions([
      '--only-addresses',
      '--case',
      'address-apple-park',
      '--output',
      'results/addresses.json',
    ])
    expect(options).toMatchObject({
      onlyAddresses: true,
      caseId: 'address-apple-park',
      output: 'results/addresses.json',
    })
    expect(selectCases(sampleCases, options).map(({ id }) => id)).toEqual(['address-apple-park'])
  })
})
