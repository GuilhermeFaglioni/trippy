import type { TripSummary } from './trips-client'

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

type DateParts = { year: number; month: number; day: number }

function parseIsoDate(isoDate: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return null

  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function dayNumber({ year, month, day }: DateParts): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

/** "12–24 out" no mesmo mês; "28 out – 3 nov" quando cruza o mês. */
export function formatDateRange(startDate: string, endDate: string): string {
  const start = parseIsoDate(startDate)
  const end = parseIsoDate(endDate)
  if (!start || !end) return `${startDate} – ${endDate}`

  if (start.year === end.year && start.month === end.month) {
    return start.day === end.day
      ? `${start.day} ${MONTHS[start.month - 1]}`
      : `${start.day}–${end.day} ${MONTHS[end.month - 1]}`
  }

  return `${start.day} ${MONTHS[start.month - 1]} – ${end.day} ${MONTHS[end.month - 1]}`
}

/** "mar 2027": mês e ano da ida, para viagens em planejamento. */
export function formatMonthYear(startDate: string): string {
  const start = parseIsoDate(startDate)
  if (!start) return startDate

  return `${MONTHS[start.month - 1]} ${start.year}`
}

/** "Dia 3 de 12" a partir das datas da viagem e do dia de hoje no fuso dela. */
export function formatTripDay(trip: TripSummary, now: Date = new Date()): string {
  const start = parseIsoDate(trip.startDate)
  const end = parseIsoDate(trip.endDate)
  if (!start || !end) return ''

  const today = todayInTimeZone(trip.timezone, now)
  const total = dayNumber(end) - dayNumber(start) + 1
  const current = Math.min(Math.max(dayNumber(today) - dayNumber(start) + 1, 1), total)

  return `Dia ${current} de ${total}`
}

function todayInTimeZone(timeZone: string, now: Date): DateParts {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
    const parsed = parseIsoDate(parts)
    if (parsed) return parsed
  } catch {
    // Fuso inválido: cai para o dia local do aparelho.
  }

  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}

const DATE_INPUT_FORMS = [
  /^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/,
  /^(\d{1,2})\s+(?:de\s+)?([a-zç]{3})[a-z]*\.?\s+(?:de\s+)?(\d{4})$/i,
]

/** Aceita "12 out 2026" (como na tela) e "12/10/2026"; devolve `AAAA-MM-DD` ou null. */
export function parseDateInput(value: string): string | null {
  const text = value.trim().toLowerCase()
  let day: number
  let month: number
  let year: number

  const numeric = DATE_INPUT_FORMS[0].exec(text)
  const named = DATE_INPUT_FORMS[1].exec(text)
  if (numeric) {
    day = Number(numeric[1])
    month = Number(numeric[2])
    year = Number(numeric[3])
  } else if (named) {
    day = Number(named[1])
    month = MONTHS.indexOf(named[2]) + 1
    year = Number(named[3])
    if (month === 0) return null
  } else {
    return null
  }

  if (year < 1) return null

  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
