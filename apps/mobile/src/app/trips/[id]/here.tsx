import { useLocalSearchParams, useRouter } from 'expo-router'

import { HereScreen } from '../../../features/today/here-screen'

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

export default function HereRoute() {
  const router = useRouter()
  const params = useLocalSearchParams<{
    id?: string | string[]
    dayIndex?: string | string[]
  }>()
  const dayIndex = Number.parseInt(firstParam(params.dayIndex), 10)

  return (
    <HereScreen
      tripId={firstParam(params.id)}
      dayIndex={Number.isFinite(dayIndex) ? dayIndex : 0}
      onClose={() => router.back()}
    />
  )
}
