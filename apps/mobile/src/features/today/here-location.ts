import { Accuracy, getCurrentPositionAsync, requestForegroundPermissionsAsync } from 'expo-location'

export type HereLocationResult =
  { status: 'granted'; lat: number; lng: number } | { status: 'denied' } | { status: 'unavailable' }

const LOCATION_TIMEOUT_MS = 8_000

/**
 * Pede permissão de localização em primeiro plano e lê uma posição aproximada.
 * Deve ser chamada só depois de um toque explícito do usuário.
 */
export async function requestCurrentLocation(): Promise<HereLocationResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const permission = await requestForegroundPermissionsAsync()
    if (!permission.granted) return { status: 'denied' }

    const position = await Promise.race([
      getCurrentPositionAsync({ accuracy: Accuracy.Balanced }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('location_timeout')), LOCATION_TIMEOUT_MS)
      }),
    ])

    const { latitude, longitude } = position.coords
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { status: 'unavailable' }
    return { status: 'granted', lat: latitude, lng: longitude }
  } catch {
    return { status: 'unavailable' }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
