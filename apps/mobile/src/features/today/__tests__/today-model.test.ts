import type { LivePlace } from '@trippy/sync'
import {
  computeTodayState,
  isDayDone,
  nextPlace,
  placesOfDay,
  staleness,
} from '../today-model'

function livePlace(overrides: Partial<LivePlace>): LivePlace {
  return {
    id: 'place-1',
    tripId: 'trip-1',
    name: 'Lugar',
    dayIndex: 0,
    position: null,
    visitedByMe: false,
    createdAt: '2027-03-10T10:00:00Z',
    ...overrides,
  } as LivePlace
}

describe('computeTodayState', () => {
  const start = '2027-03-10'
  const end = '2027-03-15'
  const tz = 'America/Sao_Paulo'

  it('antes da viagem informa os dias até a partida', () => {
    expect(computeTodayState(start, end, tz, new Date('2027-03-08T12:00:00Z'))).toEqual({
      kind: 'before',
      daysUntil: 2,
    })
  })

  it('durante a viagem informa o índice e o número do dia', () => {
    expect(computeTodayState(start, end, tz, new Date('2027-03-12T15:00:00Z'))).toEqual({
      kind: 'during',
      dayIndex: 2,
      dayNumber: 3,
      totalDays: 6,
    })
  })

  it('depois da viagem é after', () => {
    expect(computeTodayState(start, end, tz, new Date('2027-03-16T12:00:00Z'))).toEqual({
      kind: 'after',
    })
  })

  it('usa a data do fuso da viagem na virada do dia', () => {
    const now = new Date('2027-03-15T02:00:00Z')
    expect(computeTodayState('2027-03-14', '2027-03-20', tz, now)).toEqual({
      kind: 'during',
      dayIndex: 0,
      dayNumber: 1,
      totalDays: 7,
    })
    expect(computeTodayState('2027-03-14', '2027-03-20', 'UTC', now)).toEqual({
      kind: 'during',
      dayIndex: 1,
      dayNumber: 2,
      totalDays: 7,
    })
  })

  it('fuso inválido cai para UTC', () => {
    expect(
      computeTodayState('2027-03-14', '2027-03-20', 'Nao/Existe', new Date('2027-03-15T02:00:00Z')),
    ).toEqual({ kind: 'during', dayIndex: 1, dayNumber: 2, totalDays: 7 })
  })

  it('datas inválidas ou fim antes do início são after', () => {
    expect(computeTodayState('2027-02-30', end, tz, new Date('2027-03-12T12:00:00Z'))).toEqual({
      kind: 'after',
    })
    expect(computeTodayState('2027-03-15', start, tz, new Date('2027-03-12T12:00:00Z'))).toEqual({
      kind: 'after',
    })
  })
})

describe('placesOfDay', () => {
  it('filtra o dia e ordena por posição com null por último', () => {
    const places = [
      livePlace({ id: 'sem-posicao', dayIndex: 1, position: null }),
      livePlace({ id: 'segundo', dayIndex: 1, position: 2 }),
      livePlace({ id: 'outro-dia', dayIndex: 0, position: 0 }),
      livePlace({ id: 'primeiro', dayIndex: 1, position: 1 }),
    ]

    expect(placesOfDay(places, 1).map((place) => place.id)).toEqual([
      'primeiro',
      'segundo',
      'sem-posicao',
    ])
  })
})

describe('nextPlace e isDayDone', () => {
  it('retorna null quando todos foram visitados', () => {
    const dayPlaces = [
      livePlace({ id: 'a', visitedByMe: true }),
      livePlace({ id: 'b', visitedByMe: true }),
    ]

    expect(nextPlace(dayPlaces)).toBeNull()
    expect(isDayDone(dayPlaces)).toBe(true)
  })

  it('retorna null e não considera concluído um dia vazio', () => {
    expect(nextPlace([])).toBeNull()
    expect(isDayDone([])).toBe(false)
  })
})

describe('staleness', () => {
  it('sem sincronização informa roteiro não atualizado e nenhum aviso de envio', () => {
    expect(staleness(null, 0, 'America/Sao_Paulo')).toEqual({
      lastUpdateLabel: 'Roteiro ainda não atualizado neste aparelho',
      notSentLabel: null,
    })
  })

  it('mostra a hora da sincronização no fuso informado', () => {
    expect(staleness('2027-03-15T17:05:00Z', 1, 'America/Sao_Paulo')).toEqual({
      lastUpdateLabel: 'Roteiro atualizado às 14:05',
      notSentLabel: '1 registro não enviado',
    })
  })

  it('pluraliza registros não enviados', () => {
    expect(staleness('2027-03-15T17:05:00Z', 2, 'America/Sao_Paulo').notSentLabel).toBe(
      '2 registros não enviados',
    )
  })
})
