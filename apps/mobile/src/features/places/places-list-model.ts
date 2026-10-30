import type { LiveMember, LivePlace } from '@trippy/sync'

export type PlaceStatusTone = 'day' | 'suggested' | 'none'
export type PlaceFilter = 'all' | 'suggested' | 'none'

export type TripDay = { dayIndex: number; label: string }

/** Ordena por mais "quero ir"; empate pelo mais antigo e depois pelo id. */
export function comparePlacesByInterest(a: LivePlace, b: LivePlace): number {
  if (a.wantCount !== b.wantCount) return b.wantCount - a.wantCount
  const createdDiff = Date.parse(a.createdAt) - Date.parse(b.createdAt)
  if (createdDiff !== 0) return createdDiff
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Lugar com dia está "no dia N"; sem dia, "sugerido" se foi outra pessoa que sugeriu
 * e "sem dia" se foi a própria pessoa (ela já sabe que ainda falta escolher o dia).
 */
export function placeStatusTone(
  place: LivePlace,
  dayCount: number,
  userId: string | null,
): PlaceStatusTone {
  if (place.dayIndex !== null && place.dayIndex >= 0 && place.dayIndex < dayCount) return 'day'
  return place.suggestedBy === userId ? 'none' : 'suggested'
}

export function placeStatusLabel(
  tone: PlaceStatusTone,
  place: LivePlace,
  canArrange: boolean,
): string {
  if (tone === 'day') {
    const base = `No dia ${(place.dayIndex ?? 0) + 1}`
    return canArrange ? `${base} · trocar` : base
  }
  const base = tone === 'suggested' ? 'Sugerido' : 'Sem dia'
  return canArrange ? `${base} · escolher dia` : base
}

export function filterCounts(tones: readonly PlaceStatusTone[]) {
  return {
    all: tones.length,
    suggested: tones.filter((tone) => tone === 'suggested').length,
    none: tones.filter((tone) => tone === 'none').length,
  }
}

/** Não há nomes no sync: "você" e, para as outras pessoas, "Pessoa N" na ordem dos membros. */
export function suggesterLabel(
  suggestedBy: string,
  userId: string | null,
  members: readonly LiveMember[],
): string {
  if (suggestedBy === userId) return 'você'
  const others = members.filter((member) => member.userId !== userId)
  const index = others.findIndex((member) => member.userId === suggestedBy)
  return index === -1 ? 'outra pessoa' : `Pessoa ${index + 1}`
}

export function placeByline(
  place: LivePlace,
  userId: string | null,
  members: readonly LiveMember[],
): string {
  const who = suggesterLabel(place.suggestedBy, userId, members)
  const comment = place.comment?.trim()
  if (comment) {
    return `${who === 'você' ? 'Você' : who} · "${comment}"`
  }
  return `Sugerido por ${who}`
}

export function createTripDays(startDate: string, endDate: string): TripDay[] {
  const parse = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/u.test(value) ? new Date(`${value}T00:00:00.000Z`) : null
  const start = parse(startDate)
  const end = parse(endDate)
  if (start === null || end === null || Number.isNaN(start.getTime()) || end < start) return []

  const days: TripDay[] = []
  const current = new Date(start)
  while (current <= end && days.length <= 365) {
    const iso = current.toISOString().slice(0, 10)
    const [year, month, day] = iso.split('-')
    days.push({ dayIndex: days.length, label: `Dia ${days.length + 1} · ${day}/${month}/${year}` })
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return days
}
