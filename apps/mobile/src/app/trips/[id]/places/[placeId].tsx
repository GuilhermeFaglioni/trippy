import { useLocalSearchParams } from 'expo-router'

import { PlaceDetailScreen } from '../../../../features/places/place-detail-screen'

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

export default function TripPlaceDetailRoute() {
  const params = useLocalSearchParams<{ id?: string | string[]; placeId?: string | string[] }>()

  return <PlaceDetailScreen tripId={firstParam(params.id)} placeId={firstParam(params.placeId)} />
}
