import { expect, it } from 'vitest'
import { isValidIsoDate, isValidTimeZone, tripPhase, validateCreateTripInput } from './trips.ts'

it.each(['2024-02-29', '2026-10-20'])('aceita a data ISO válida %s', (value) => {
  expect(isValidIsoDate(value)).toBe(true)
})

it.each(['2025-02-29', '2026-02-30', '20-10-2026', '2026-1-02', '', null])(
  'recusa a data ISO inválida %s',
  (value) => {
    expect(isValidIsoDate(value)).toBe(false)
  },
)

it('reconhece fusos aceitos por Intl e recusa fusos desconhecidos', () => {
  expect(isValidTimeZone('America/Sao_Paulo')).toBe(true)
  expect(isValidTimeZone('Pacific/Kiritimati')).toBe(true)
  expect(isValidTimeZone('Not/A_Timezone')).toBe(false)
  expect(isValidTimeZone('')).toBe(false)
})

it('calcula fase pela data local da viagem, com limites inclusivos', () => {
  const trip = {
    startDate: '2026-01-02',
    endDate: '2026-01-02',
    timezone: 'Pacific/Kiritimati',
    endedAt: null,
  }

  expect(tripPhase(trip, new Date('2026-01-01T09:59:00.000Z'))).toBe('planning')
  expect(tripPhase(trip, new Date('2026-01-01T10:00:00.000Z'))).toBe('traveling')
  expect(tripPhase(trip, new Date('2026-01-02T09:59:00.000Z'))).toBe('traveling')
  expect(tripPhase(trip, new Date('2026-01-02T10:00:00.000Z'))).toBe('ended')
})

it('encerra a viagem quando endedAt está preenchido', () => {
  expect(
    tripPhase(
      {
        startDate: '2026-10-20',
        endDate: '2026-10-22',
        timezone: 'America/Sao_Paulo',
        endedAt: new Date('2026-10-21T12:00:00.000Z'),
      },
      new Date('2026-10-20T12:00:00.000Z'),
    ),
  ).toBe('ended')
})

it('valida a criação e devolve nome e destino aparados', () => {
  expect(
    validateCreateTripInput({
      name: '  Férias  ',
      destination: '  Lisboa  ',
      startDate: '2026-10-20',
      endDate: '2026-10-22',
      timezone: 'Europe/Lisbon',
    }),
  ).toEqual({
    success: true,
    value: {
      name: 'Férias',
      destination: 'Lisboa',
      startDate: '2026-10-20',
      endDate: '2026-10-22',
      timezone: 'Europe/Lisbon',
    },
  })
})

it('retorna os campos inválidos do corpo de criação', () => {
  const result = validateCreateTripInput({
    name: ' ',
    destination: 'x'.repeat(121),
    startDate: '2026-02-01',
    endDate: '2026-01-01',
    timezone: 'Mars/Olympus',
  })

  expect(result).toMatchObject({
    success: false,
    fields: {
      name: expect.any(String),
      destination: expect.any(String),
      endDate: expect.any(String),
      timezone: expect.any(String),
    },
  })
})
