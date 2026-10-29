import type { LivePlace } from '@trippy/sync'

export type TodayPlace = LivePlace

export type TodayState =
  | { kind: 'before'; daysUntil: number }
  | { kind: 'during'; dayIndex: number; dayNumber: number; totalDays: number }
  | { kind: 'after' }

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const MAX_RECENT_CHANGES = 5

export function computeTodayState(
  startDate: string,
  endDate: string,
  timezone: string,
  now: Date,
): TodayState {
  const start = dayNumberOf(startDate)
  const end = dayNumberOf(endDate)
  if (start === null || end === null || end < start || Number.isNaN(now.getTime())) {
    return { kind: 'after' }
  }

  const today = todayDayNumber(now, timezone)
  if (today < start) return { kind: 'before', daysUntil: start - today }
  if (today > end) return { kind: 'after' }

  const dayIndex = today - start
  return { kind: 'during', dayIndex, dayNumber: dayIndex + 1, totalDays: end - start + 1 }
}

export function placesOfDay(places: readonly TodayPlace[], dayIndex: number): TodayPlace[] {
  return places
    .filter((place) => place.dayIndex === dayIndex)
    .sort((a, b) => comparePosition(a.position, b.position))
}

export function nextPlace(dayPlaces: readonly TodayPlace[]): TodayPlace | null {
  return dayPlaces.find((place) => place.visitedByMe === false) ?? null
}

export function isDayDone(dayPlaces: readonly TodayPlace[]): boolean {
  return dayPlaces.length > 0 && dayPlaces.every((place) => place.visitedByMe)
}

export function recentChanges(
  places: readonly TodayPlace[],
  now: Date,
  windowHours = 24,
): TodayPlace[] {
  const upper = now.getTime()
  const lower = upper - windowHours * HOUR_MS
  return places
    .map((place) => ({ place, at: Date.parse(place.createdAt) }))
    .filter(({ at }) => at >= lower && at <= upper)
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_RECENT_CHANGES)
    .map(({ place }) => place)
}

export function staleness(
  lastSyncedAt: string | null,
  notSent: number,
  timeZone: string,
): { lastUpdateLabel: string; notSentLabel: string | null } {
  return {
    lastUpdateLabel: lastUpdateLabel(lastSyncedAt, timeZone),
    notSentLabel: notSentLabel(notSent),
  }
}

function dayNumberOf(isoDay: string): number | null {
  const match = ISO_DAY.exec(isoDay)
  if (match === null) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const time = Date.UTC(year, month - 1, day)
  const date = new Date(time)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return time / DAY_MS
}

function resolveTimeZone(timeZone: string): string {
  try {
    Intl.DateTimeFormat('en-CA', { timeZone }).resolvedOptions()
    return timeZone
  } catch {
    return 'UTC'
  }
}

function todayDayNumber(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value)
  return Date.UTC(part('year'), part('month') - 1, part('day')) / DAY_MS
}

function comparePosition(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

function lastUpdateLabel(lastSyncedAt: string | null, timeZone: string): string {
  const time = new Date(lastSyncedAt ?? Number.NaN)
  if (Number.isNaN(time.getTime())) return 'Roteiro ainda não atualizado neste aparelho'
  const hour = new Intl.DateTimeFormat('pt-BR', {
    timeZone: resolveTimeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(time)
  return `Roteiro atualizado às ${hour}`
}

function notSentLabel(notSent: number): string | null {
  if (notSent <= 0) return null
  return notSent === 1 ? '1 registro não enviado' : `${notSent} registros não enviados`
}
