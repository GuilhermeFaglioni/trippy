import { useLocalSearchParams, useRouter } from 'expo-router'

import { PlaceDetailScreen } from '../../../../features/places/place-detail-screen'

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

export default function TripPlaceDetailRoute() {
  const router = useRouter()
  const params = useLocalSearchParams<{ id?: string | string[]; placeId?: string | string[] }>()

  const tripId = firstParam(params.id)

  return (
    <PlaceDetailScreen
      tripId={tripId}
      placeId={firstParam(params.placeId)}
      onBack={() => router.back()}
      onShowAddress={(placeId) =>
        router.push({ pathname: '/trips/[id]/address-card', params: { id: tripId, placeId } })
      }
      onOpenPhotos={() => router.push({ pathname: '/trips/[id]/photos', params: { id: tripId } })}
    />
  )
}
