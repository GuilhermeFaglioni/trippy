import { describe, expect, it } from 'vitest'
import { signPlaceSearchCandidate, verifyPlaceSearchCandidate } from './candidate-token.ts'

const candidate = {
  provider: 'geoapify' as const,
  providerRef: 'geo-123',
  name: 'Museu do Amanhã',
  localName: 'Museu do Amanhã',
  address: 'Praça Mauá, 1',
  localAddress: 'Praça Mauá, 1',
  lat: -22.894,
  lng: -43.179,
  countryCode: 'br',
  datasource: 'openstreetmap',
  attribution: '© OpenStreetMap contributors',
  license: 'ODbL',
  method: 'geocoding' as const,
}

describe('assinatura do candidato de lugar', () => {
  it('assina os campos e verifica assinatura válida independente da ordem das chaves', () => {
    const signed = signPlaceSearchCandidate(
      candidate,
      'segredo-local-de-teste-com-mais-de-32-bytes',
    )
    const reordered = Object.fromEntries(Object.entries(signed).reverse())

    expect(verifyPlaceSearchCandidate(signed, 'segredo-local-de-teste-com-mais-de-32-bytes')).toBe(
      true,
    )
    expect(
      verifyPlaceSearchCandidate(
        reordered as typeof signed,
        'segredo-local-de-teste-com-mais-de-32-bytes',
      ),
    ).toBe(true)
  })

  it('detecta campos alterados e tokens adulterados', () => {
    const signed = signPlaceSearchCandidate(
      candidate,
      'segredo-local-de-teste-com-mais-de-32-bytes',
    )

    expect(
      verifyPlaceSearchCandidate(
        { ...signed, name: 'Outro lugar' },
        'segredo-local-de-teste-com-mais-de-32-bytes',
      ),
    ).toBe(false)
    expect(
      verifyPlaceSearchCandidate(
        { ...signed, token: `${signed.token.slice(0, -1)}x` },
        'segredo-local-de-teste-com-mais-de-32-bytes',
      ),
    ).toBe(false)
  })
})
