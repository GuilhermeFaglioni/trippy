import { expect, it } from 'vitest'
import {
  isValidIsoDate,
  isValidTimeZone,
  readyToTravel,
  tripPhase,
  validateCreateTripInput,
} from './trips.ts'

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

const readyBase = {
  phase: 'planning' as const,
  startDate: '2026-11-10',
  timezone: 'America/Sao_Paulo',
  now: new Date('2026-11-03T15:00:00.000Z'),
  destination: 'Xangai',
  places: [{ countryCode: 'CN', localAddressStatus: 'missing' as const }],
  members: [
    { userId: 'ana', openedAt: '2026-10-30T10:00:00.000Z' },
    { userId: 'bruno', openedAt: null },
  ],
}

it('aparece na janela de 7 dias antes do início quando há pendência', () => {
  expect(readyToTravel(readyBase)).toEqual({
    visible: true,
    placesWithoutLocalAddress: 1,
    recommendRegisterBeforeBoarding: true,
    membersOpened: 1,
    membersTotal: 2,
    membersNotOpened: ['bruno'],
    daysUntilStart: 7,
  })
})

it('não aparece a mais de 7 dias do início e aceita o limite exato', () => {
  expect(readyToTravel({ ...readyBase, now: new Date('2026-11-02T15:00:00.000Z') }).visible).toBe(
    false,
  )
  expect(readyToTravel({ ...readyBase, now: new Date('2026-11-03T03:00:00.000Z') }).visible).toBe(
    true,
  )
})

it('usa a data civil do fuso da viagem para calcular a janela', () => {
  // 2026-11-03 02:30 UTC ainda é 2026-11-02 em São Paulo: faltam 8 dias.
  const now = new Date('2026-11-03T02:30:00.000Z')
  expect(readyToTravel({ ...readyBase, now }).visible).toBe(false)
  expect(readyToTravel({ ...readyBase, timezone: 'Asia/Shanghai', now }).visible).toBe(true)
})

it('recomenda cadastrar endereços antes do embarque para China pelo país ou destino', () => {
  const byDestination = readyToTravel({
    ...readyBase,
    destination: 'Pequim, CHINA',
    places: [{ countryCode: 'PT', localAddressStatus: 'missing' }],
  })
  expect(byDestination.recommendRegisterBeforeBoarding).toBe(true)

  const byCountry = readyToTravel({
    ...readyBase,
    destination: 'Lisboa',
    places: [{ countryCode: 'CN', localAddressStatus: 'ok' }],
  })
  expect(byCountry.recommendRegisterBeforeBoarding).toBe(true)

  const neither = readyToTravel({
    ...readyBase,
    destination: 'Lisboa',
    places: [{ countryCode: 'PT', localAddressStatus: 'missing' }],
  })
  expect(neither.recommendRegisterBeforeBoarding).toBe(false)
})

it('some quando todos os endereços locais e aberturas estão prontos', () => {
  const summary = readyToTravel({
    ...readyBase,
    places: [
      { countryCode: 'CN', localAddressStatus: 'ok' },
      { countryCode: 'CN', localAddressStatus: 'ok' },
    ],
    members: [
      { userId: 'ana', openedAt: '2026-10-30T10:00:00.000Z' },
      { userId: 'bruno', openedAt: '2026-10-31T10:00:00.000Z' },
    ],
  })
  expect(summary).toMatchObject({
    visible: false,
    placesWithoutLocalAddress: 0,
    membersOpened: 2,
    membersTotal: 2,
    membersNotOpened: [],
  })
})

it('considera pendente endereço com status diferente de ok, inclusive incompleto', () => {
  const summary = readyToTravel({
    ...readyBase,
    places: [
      { countryCode: 'PT', localAddressStatus: 'incomplete' },
      { countryCode: 'PT', localAddressStatus: 'not_local_language' },
      { countryCode: 'PT', localAddressStatus: 'ok' },
    ],
    members: [{ userId: 'ana', openedAt: '2026-10-30T10:00:00.000Z' }],
  })
  expect(summary.placesWithoutLocalAddress).toBe(2)
  expect(summary.visible).toBe(true)
})

it('não aparece fora da fase de planejamento', () => {
  expect(readyToTravel({ ...readyBase, phase: 'traveling' }).visible).toBe(false)
  expect(readyToTravel({ ...readyBase, phase: 'ended' }).visible).toBe(false)
})
