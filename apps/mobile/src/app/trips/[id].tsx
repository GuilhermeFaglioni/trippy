import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Platform, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button, Card, Notice } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import { ItineraryScreen } from '../../features/itinerary/itinerary-screen'
import { MembersScreen } from '../../features/members/members-screen'
import { useSync } from '../../features/sync/sync-provider'
import { TripPlacesScreen } from '../../features/places/trip-places-screen'
import { useTripsClient, type TripRole, type TripSummary } from '../../features/trips/trips-client'

/** TestIDs Maestro: viagem-removida, trip-tab-lugares, trip-tab-roteiro, trip-tab-grupo. */
const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

type TripSection = 'lugares' | 'roteiro' | 'grupo'
type MembershipState = 'loading' | 'active' | 'removed' | 'error'

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function tripRole(value: string): TripRole {
  if (value === 'organizer' || value === 'coorganizer') return value
  return 'member'
}

function RemovedTripNotice({ pending }: { pending: number }) {
  const theme = useTheme()
  const count = Math.max(0, pending)
  return (
    <SafeAreaView
      testID="viagem-removida"
      style={{
        flex: 1,
        justifyContent: 'center',
        backgroundColor: theme.colors.ground,
        padding: theme.spacing.space5,
      }}
    >
      <Card>
        <View style={{ gap: theme.spacing.space3 }}>
          <TypographyText family="display" style={[typography.titleM, { color: theme.colors.ink }]}>
            Você não faz mais parte desta viagem.
          </TypographyText>
          <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
            {`${count} ${count === 1 ? 'alteração não enviada' : 'alterações não enviadas'}.`}
          </TypographyText>
        </View>
      </Card>
    </SafeAreaView>
  )
}

function TripTabs({
  active,
  onChange,
}: {
  active: TripSection
  onChange: (section: TripSection) => void
}) {
  const theme = useTheme()
  return (
    <View
      testID="viagem-abas"
      style={{
        backgroundColor: theme.colors.ground,
        borderBottomColor: theme.colors.line,
        borderBottomWidth: 1,
        flexDirection: 'row',
        gap: theme.spacing.space2,
        padding: theme.spacing.space3,
      }}
    >
      <Button
        label="Lugares"
        variant="secondary"
        selected={active === 'lugares'}
        onPress={() => onChange('lugares')}
        testID="trip-tab-lugares"
      />
      <Button
        label="Roteiro"
        variant="secondary"
        selected={active === 'roteiro'}
        onPress={() => onChange('roteiro')}
        testID="trip-tab-roteiro"
      />
      <Button
        label="Grupo"
        variant="secondary"
        selected={active === 'grupo'}
        onPress={() => onChange('grupo')}
        testID="trip-tab-grupo"
      />
    </View>
  )
}

export default function TripRoute() {
  const params = useLocalSearchParams<{
    id?: string | string[]
    tripName?: string | string[]
    role?: string | string[]
    startDate?: string | string[]
    endDate?: string | string[]
  }>()
  const theme = useTheme()
  const tripId = firstParam(params.id)
  const tripName = firstParam(params.tripName)
  const role = tripRole(firstParam(params.role))
  const routeStartDate = firstParam(params.startDate)
  const routeEndDate = firstParam(params.endDate)
  const { client, ready, error: syncError, removedTrips } = useSync()
  const tripsClient = useTripsClient()
  const [membership, setMembership] = useState<MembershipState>('loading')
  const [notSentCount, setNotSentCount] = useState(0)
  const [section, setSection] = useState<TripSection>('lugares')
  const [trip, setTrip] = useState<TripSummary | null>(null)

  const checkMembership = useCallback(async () => {
    if (!ready) return
    if (client === null) {
      setMembership('error')
      return
    }
    try {
      const isRemoved =
        removedTrips.includes(tripId) || (await client.listRemovedTrips()).includes(tripId)
      if (isRemoved) {
        setNotSentCount(Math.max(0, await client.countNotSent(tripId)))
        setMembership('removed')
      } else {
        setMembership('active')
      }
    } catch {
      setMembership('error')
    }
  }, [client, ready, removedTrips, tripId])

  useEffect(() => {
    void checkMembership()
    if (client === null) return
    return client.subscribe(() => void checkMembership())
  }, [checkMembership, client])

  useEffect(() => {
    if (membership !== 'active' || !tripId) return
    let active = true
    void tripsClient
      .listTrips()
      .then((trips) => {
        if (active) setTrip(trips.find((candidate) => candidate.id === tripId) ?? null)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [membership, tripsClient, tripId])

  const startDate = trip?.startDate ?? routeStartDate
  const endDate = trip?.endDate ?? routeEndDate
  const displayName = trip?.name ?? tripName
  const routeContent = useMemo(() => {
    if (section === 'roteiro') {
      return <ItineraryScreen tripId={tripId} startDate={startDate} endDate={endDate} />
    }
    if (section === 'grupo') return <MembersScreen tripId={tripId} />
    return <TripPlacesScreen tripId={tripId} tripName={displayName} role={role} />
  }, [displayName, endDate, role, section, startDate, tripId])

  if (membership === 'loading') {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.ground,
        }}
      >
        <ActivityIndicator testID="viagem-verificando-acesso" color={theme.colors.forest} />
      </SafeAreaView>
    )
  }

  if (membership === 'removed') return <RemovedTripNotice pending={notSentCount} />

  if (membership === 'error') {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          justifyContent: 'center',
          backgroundColor: theme.colors.ground,
          padding: theme.spacing.space5,
        }}
      >
        <Notice
          testID="viagem-acesso-indisponivel"
          tone="warning"
          title="Não foi possível verificar seu acesso."
          message="Os dados da viagem ficam ocultos até confirmar se você ainda faz parte do grupo."
        />
      </SafeAreaView>
    )
  }

  return (
    <View testID="trip-route" style={{ flex: 1, backgroundColor: theme.colors.ground }}>
      <SafeAreaView edges={['top']}>
        <View
          style={{
            gap: theme.spacing.space2,
            paddingHorizontal: theme.spacing.space5,
            paddingTop: theme.spacing.space3,
          }}
        >
          <TypographyText family="display" style={[typography.titleM, { color: theme.colors.ink }]}>
            {displayName || 'Viagem'}
          </TypographyText>
        </View>
        <TripTabs active={section} onChange={setSection} />
      </SafeAreaView>
      <View style={{ flex: 1 }}>
        {syncError ? (
          <View
            style={{ paddingHorizontal: theme.spacing.space5, paddingTop: theme.spacing.space3 }}
          >
            <Notice testID="trip-sync-unavailable" tone="warning" message={syncError} />
          </View>
        ) : null}
        {routeContent}
      </View>
    </View>
  )
}
