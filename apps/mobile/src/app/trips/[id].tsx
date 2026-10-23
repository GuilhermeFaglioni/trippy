import { useLocalSearchParams, useRouter } from 'expo-router'

import { TripPlacesScreen } from '../../features/places/trip-places-screen'
import type { TripRole } from '../../features/trips/trips-client'

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function tripRole(value: string): TripRole {
  if (value === 'organizer' || value === 'coorganizer') return value
  return 'member'
}

export default function TripRoute() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    id?: string | string[]
    tripName?: string | string[]
    role?: string | string[]
  }>()
  return (
    <TripPlacesScreen
      tripId={firstParam(params.id)}
      tripName={firstParam(params.tripName)}
      role={tripRole(firstParam(params.role))}
      onOpenPhotos={() =>
        router.push({
          pathname: '/trips/[id]/photos',
          params: { id: firstParam(params.id), tripName: firstParam(params.tripName) },
        })
      }
    />
  )
}
