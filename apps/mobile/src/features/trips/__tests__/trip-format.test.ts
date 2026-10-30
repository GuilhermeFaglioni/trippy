import { formatDateRange, formatMonthYear, formatTripDay, parseDateInput } from '../trip-format'
import type { TripSummary } from '../trips-client'

const trip: TripSummary = {
  id: '58f75ed5-b524-46f8-b387-650d9b43ee36',
  name: 'Viagem China',
  destination: 'China',
  startDate: '2026-10-12',
  endDate: '2026-10-24',
  timezone: 'Asia/Shanghai',
  role: 'organizer',
  phase: 'traveling',
  createdAt: '2026-10-01T12:00:00.000Z',
}

describe('formatação das viagens', () => {
  it('formata o intervalo de datas como na referência', () => {
    expect(formatDateRange('2026-10-12', '2026-10-24')).toBe('12–24 out')
    expect(formatDateRange('2026-10-28', '2026-11-03')).toBe('28 out – 3 nov')
    expect(formatMonthYear('2027-03-14')).toBe('mar 2027')
  })

  it('conta o dia da viagem no fuso dela, sem passar do total', () => {
    expect(formatTripDay(trip, new Date('2026-10-14T06:00:00Z'))).toBe('Dia 3 de 13')
    expect(formatTripDay(trip, new Date('2026-12-01T06:00:00Z'))).toBe('Dia 13 de 13')
    expect(formatTripDay(trip, new Date('2026-09-01T06:00:00Z'))).toBe('Dia 1 de 13')
  })

  it('aceita "12 out 2026" e "12/10/2026" e recusa datas inexistentes', () => {
    expect(parseDateInput('12 out 2026')).toBe('2026-10-12')
    expect(parseDateInput('12/10/2026')).toBe('2026-10-12')
    expect(parseDateInput('29 fev 2028')).toBe('2028-02-29')
    expect(parseDateInput('29 fev 2027')).toBeNull()
    expect(parseDateInput('12 xyz 2026')).toBeNull()
    expect(parseDateInput('')).toBeNull()
  })
})
