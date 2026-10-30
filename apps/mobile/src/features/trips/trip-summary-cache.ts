import Storage from 'expo-sqlite/kv-store'

import { isTripSummary, type TripSummary } from './trips-client'

const keyFor = (tripId: string) => `trippy.trip-summary.${tripId}`

/** Guarda o último resumo visto online: datas e fase são necessárias para o Roteiro offline. */
export async function saveTripSummary(trip: TripSummary): Promise<void> {
  try {
    await Storage.setItemAsync(keyFor(trip.id), JSON.stringify(trip))
  } catch {
    // Cache é melhor esforço; a tela continua funcionando online.
  }
}

export async function loadTripSummary(tripId: string): Promise<TripSummary | null> {
  try {
    const raw = await Storage.getItemAsync(keyFor(tripId))
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return isTripSummary(parsed) && parsed.id === tripId ? parsed : null
  } catch {
    return null
  }
}
