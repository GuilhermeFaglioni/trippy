import type { LocalDetailStatus } from './places.ts'
import type { Role } from './roles.ts'

/** Verifica data civil no formato exato YYYY-MM-DD. */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const year = Number(value.slice(0, 4))
  if (year < 1) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export type TripPhase = 'planning' | 'traveling' | 'ended'

export interface TripPhaseInput {
  startDate: string
  endDate: string
  timezone: string
  endedAt: Date | null
}

export function tripPhase(trip: TripPhaseInput, now: Date): TripPhase {
  if (trip.endedAt !== null) return 'ended'

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: trip.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  const localDate = `${values.year!.padStart(4, '0')}-${values.month}-${values.day}`

  if (localDate < trip.startDate) return 'planning'
  if (localDate <= trip.endDate) return 'traveling'
  return 'ended'
}

export interface CreateTripInput {
  name: string
  destination: string
  startDate: string
  endDate: string
  timezone: string
}

export interface TripSummary extends CreateTripInput {
  id: string
  role: Role
  phase: TripPhase
  createdAt: string
}

export type CreateTripValidation =
  | { success: true; value: CreateTripInput }
  | { success: false; fields: Partial<Record<keyof CreateTripInput, string>> }

export function validateCreateTripInput(value: unknown): CreateTripValidation {
  const body =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const fields: Partial<Record<keyof CreateTripInput, string>> = {}

  function requiredText(field: 'name' | 'destination', label: string): string {
    const candidate = body[field]
    if (typeof candidate !== 'string') {
      fields[field] = `Informe ${label}.`
      return ''
    }
    const trimmed = candidate.trim()
    const characterCount = Array.from(trimmed).length
    if (characterCount < 1 || characterCount > 120) {
      fields[field] =
        `${label[0]!.toUpperCase()}${label.slice(1)} deve ter entre 1 e 120 caracteres.`
    }
    return trimmed
  }

  const name = requiredText('name', 'um nome')
  const destination = requiredText('destination', 'um destino')

  const startDate = body.startDate
  const validStartDate = isValidIsoDate(startDate)
  if (!validStartDate) fields.startDate = 'Informe uma data de ida válida no formato AAAA-MM-DD.'

  const endDate = body.endDate
  const validEndDate = isValidIsoDate(endDate)
  if (!validEndDate) fields.endDate = 'Informe uma data de volta válida no formato AAAA-MM-DD.'
  else if (validStartDate && endDate < startDate) {
    fields.endDate = 'A data de volta deve ser igual ou posterior à data de ida.'
  }

  const timezone = body.timezone
  const validTimezone = isValidTimeZone(timezone)
  if (!validTimezone) fields.timezone = 'Informe um fuso horário IANA válido.'

  if (Object.keys(fields).length > 0 || !validStartDate || !validEndDate || !validTimezone) {
    return { success: false, fields }
  }

  return {
    success: true,
    value: { name, destination, startDate, endDate, timezone },
  }
}

/** Janela do aviso "Pronto para viajar": até 7 dias antes do início. */
export const READY_TO_TRAVEL_WINDOW_DAYS = 7

export interface ReadyToTravelPlaceInput {
  countryCode: string | null
  localAddressStatus: LocalDetailStatus
}

export interface ReadyToTravelMemberInput {
  userId: string
  openedAt: string | null
}

export interface ReadyToTravelInput {
  phase: TripPhase
  startDate: string
  timezone: string
  now: Date
  destination: string
  places: readonly ReadyToTravelPlaceInput[]
  members: readonly ReadyToTravelMemberInput[]
}

export interface ReadyToTravelSummary {
  visible: boolean
  placesWithoutLocalAddress: number
  recommendRegisterBeforeBoarding: boolean
  membersOpened: number
  membersTotal: number
  membersNotOpened: string[]
}

function localDateInTimezone(timezone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year!.padStart(4, '0')}-${values.month}-${values.day}`
}

function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  const from = Date.parse(`${fromIsoDate}T00:00:00.000Z`)
  const to = Date.parse(`${toIsoDate}T00:00:00.000Z`)
  return Math.round((to - from) / 86_400_000)
}

/**
 * Resume o que falta antes do embarque. O aviso só fica visível na fase de planejamento,
 * até 7 dias antes do início (data civil no fuso da viagem) e quando há alguma pendência.
 */
export function readyToTravel(input: ReadyToTravelInput): ReadyToTravelSummary {
  const placesWithoutLocalAddress = input.places.filter(
    (place) => place.localAddressStatus !== 'ok',
  ).length
  const recommendRegisterBeforeBoarding =
    input.places.some((place) => place.countryCode === 'CN') ||
    input.destination.toLowerCase().includes('china')
  const membersNotOpened = input.members
    .filter((member) => member.openedAt === null)
    .map((member) => member.userId)
  const membersTotal = input.members.length
  const membersOpened = membersTotal - membersNotOpened.length

  const daysUntilStart = daysBetween(
    localDateInTimezone(input.timezone, input.now),
    input.startDate,
  )
  const inWindow =
    input.phase === 'planning' &&
    daysUntilStart >= 0 &&
    daysUntilStart <= READY_TO_TRAVEL_WINDOW_DAYS
  const hasPending = placesWithoutLocalAddress > 0 || membersNotOpened.length > 0

  return {
    visible: inWindow && hasPending,
    placesWithoutLocalAddress,
    recommendRegisterBeforeBoarding,
    membersOpened,
    membersTotal,
    membersNotOpened,
  }
}
