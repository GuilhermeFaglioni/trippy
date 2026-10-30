import { useLocalSearchParams, useRouter } from 'expo-router'

import { AddressCardScreen } from '../../../features/places/address-card-screen'

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

export default function AddressCardRoute() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    id?: string | string[]
    placeId?: string | string[]
    tripName?: string | string[]
    role?: string | string[]
  }>()
  const tripId = firstParam(params.id)

  return (
    <AddressCardScreen
      tripId={tripId}
      placeId={firstParam(params.placeId)}
      onClose={() => router.back()}
      onComplete={() => router.replace({ pathname: '/trips/[id]', params: { id: tripId } })}
    />
  )
}
