import type { LiveMember, LivePlace } from '@trippy/sync'
import {
  createTripDays,
  placeByline,
  placeStatusLabel,
  placeStatusTone,
} from '../places-list-model'

const place = (overrides: Partial<LivePlace>) =>
  ({ suggestedBy: 'u2', dayIndex: null, comment: null, ...overrides }) as LivePlace

const members = [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }] as LiveMember[]

describe('modelo da lista de lugares', () => {
  it('classifica status e monta o rótulo conforme o papel', () => {
    expect(placeStatusTone(place({ dayIndex: 4 }), 7, 'u1')).toBe('day')
    expect(placeStatusTone(place({ dayIndex: 9 }), 7, 'u1')).toBe('suggested')
    expect(placeStatusTone(place({}), 7, 'u1')).toBe('suggested')
    expect(placeStatusTone(place({ suggestedBy: 'u1' }), 7, 'u1')).toBe('none')
    expect(placeStatusLabel('day', place({ dayIndex: 4 }), true)).toBe('No dia 5 · trocar')
    expect(placeStatusLabel('day', place({ dayIndex: 4 }), false)).toBe('No dia 5')
    expect(placeStatusLabel('suggested', place({}), true)).toBe('Sugerido · escolher dia')
    expect(placeStatusLabel('none', place({}), false)).toBe('Sem dia')
  })

  it('descreve quem sugeriu, com comentário quando há', () => {
    expect(placeByline(place({ suggestedBy: 'u1' }), 'u1', members)).toBe('Sugerido por você')
    expect(placeByline(place({ suggestedBy: 'u3' }), 'u1', members)).toBe('Sugerido por Pessoa 2')
    expect(placeByline(place({ comment: 'vista incrível' }), 'u1', members)).toBe(
      'Pessoa 1 · "vista incrível"',
    )
  })

  it('gera os dias da viagem e ignora datas inválidas', () => {
    expect(createTripDays('2026-11-01', '2026-11-02').map((day) => day.label)).toEqual([
      'Dia 1 · 01/11/2026',
      'Dia 2 · 02/11/2026',
    ])
    expect(createTripDays('', '')).toEqual([])
    expect(createTripDays('2026-11-05', '2026-11-01')).toEqual([])
  })
})
