import { useLocalSearchParams } from 'expo-router'

import { TripPhotosScreen } from '../../../features/photos/trip-photos-screen'

export default function TripPhotosRoute() {
  const { id, tripName } = useLocalSearchParams<{ id: string; tripName?: string }>()
  return <TripPhotosScreen tripId={id} tripName={tripName ?? ''} />
}
