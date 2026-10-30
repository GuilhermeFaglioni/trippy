import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Platform, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Card, Notice } from '../../components'
import { ScreenHeader, TabBar, tripTabs, type TabBarItem } from '../../design-system/components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import { ItineraryScreen } from '../../features/itinerary/itinerary-screen'
import { TripMemoriesScreen } from '../../features/photos/trip-memories-screen'
import { MembersScreen } from '../../features/members/members-screen'
import { useSync } from '../../features/sync/sync-provider'
import { TripPlacesScreen } from '../../features/places/trip-places-screen'
import { ReadyToTravelCard } from '../../features/trips/ready-to-travel-card'
import { loadTripSummary, saveTripSummary } from '../../features/trips/trip-summary-cache'
import { TodayScreen } from '../../features/today/today-screen'
import {
  useTripsClient,
  type TripPhase,
  type TripRole,
  type TripSummary,
} from '../../features/trips/trips-client'

/** TestIDs Maestro: viagem-removida, trip-tab-lugares, trip-tab-roteiro, trip-tab-grupo, trip-tab-hoje. */
const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

/** Aba inicial por fase; Hoje e Recap entram nas telas próprias. */
function initialSection(phase: TripPhase): TripSection {
  return phase === 'traveling' ? 'hoje' : 'lugares'
}

type TripSection = 'hoje' | 'roteiro' | 'lugares' | 'memorias' | 'grupo'

const SECTION_TITLES: Record<TripSection, string> = {
  hoje: 'Hoje',
  roteiro: 'Roteiro',
  lugares: 'Lugares',
  memorias: 'Memórias',
  grupo: 'Grupo',
}

const SECTION_TABS: Record<TripSection, TabBarItem> = {
  hoje: { ...tripTabs.today, testID: 'trip-tab-hoje' },
  roteiro: { ...tripTabs.itinerary, testID: 'trip-tab-roteiro' },
  lugares: { ...tripTabs.places, testID: 'trip-tab-lugares' },
  memorias: { ...tripTabs.memories, testID: 'trip-tab-memorias' },
  grupo: { ...tripTabs.group, testID: 'trip-tab-grupo' },
}
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

export default function TripRoute() {
  const router = useRouter()
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
  const sectionChosenRef = useRef(false)
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const openedTripRef = useRef<string | null>(null)

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
        if (!active) return
        const found = trips.find((candidate) => candidate.id === tripId) ?? null
        setTrip(found)
        if (found) void saveTripSummary(found)
        if (found && !sectionChosenRef.current) setSection(initialSection(found.phase))
      })
      .catch(async () => {
        // Sem rede: usa o último resumo visto online (datas do Roteiro, fase, papel).
        const cached = await loadTripSummary(tripId)
        if (!active || cached === null) return
        setTrip(cached)
        if (!sectionChosenRef.current) setSection(initialSection(cached.phase))
      })
    return () => {
      active = false
    }
  }, [membership, tripsClient, tripId])

  useEffect(() => {
    if (membership !== 'active' || client === null || !tripId) return
    if (openedTripRef.current === tripId) return
    openedTripRef.current = tripId
    void (async () => {
      try {
        await client.openTrip(tripId)
      } catch {
        // Registrar a abertura é melhor esforço; a viagem continua disponível.
      }
    })()
  }, [client, membership, tripId])

  const phase: TripPhase | null = trip?.phase ?? null
  const canSeeReadyToTravel =
    trip !== null && (trip.role === 'organizer' || trip.role === 'coorganizer')
  const startDate = trip?.startDate ?? routeStartDate
  const endDate = trip?.endDate ?? routeEndDate
  const timezone = trip?.timezone ?? 'UTC'
  const displayName = trip?.name ?? tripName
  const routeContent = useMemo(() => {
    const openPhotos = () =>
      router.push({
        pathname: '/trips/[id]/photos',
        params: { id: tripId, tripName: displayName },
      })
    const openAddressCard = (placeId: string) =>
      router.push({
        pathname: '/trips/[id]/address-card',
        params: { id: tripId, placeId },
      })
    const openHere = (dayIndex: number) =>
      router.push({
        pathname: '/trips/[id]/here',
        params: { id: tripId, dayIndex: String(dayIndex) },
      })
    if (section === 'hoje') {
      return (
        <TodayScreen
          tripId={tripId}
          timezone={timezone}
          startDate={startDate}
          endDate={endDate}
          onOpenPhotos={openPhotos}
          onShowAddress={openAddressCard}
          onHere={openHere}
        />
      )
    }
    if (section === 'roteiro') {
      return (
        <ItineraryScreen
          tripId={tripId}
          startDate={startDate}
          endDate={endDate}
          onOpenPlaces={() => {
            sectionChosenRef.current = true
            setSection('lugares')
          }}
          onOpenPlace={(placeId) =>
            router.push({
              pathname: '/trips/[id]/places/[placeId]',
              params: { id: tripId, placeId },
            })
          }
        />
      )
    }
    if (section === 'memorias') return <TripMemoriesScreen onSendPhotos={openPhotos} />
    if (section === 'grupo') {
      return (
        <MembersScreen
          tripId={tripId}
          tripName={displayName}
          onMemberCount={setMemberCount}
          onOpenSettings={() =>
            router.push({
              pathname: '/trips/[id]/settings',
              params: { id: tripId, tripName: displayName, role },
            })
          }
        />
      )
    }
    return (
      <TripPlacesScreen
        tripId={tripId}
        tripName={displayName}
        role={role}
        startDate={startDate}
        endDate={endDate}
      />
    )
  }, [displayName, endDate, role, router, section, startDate, timezone, tripId])

  const tabKeys: TripSection[] =
    phase === 'traveling'
      ? ['hoje', 'roteiro', 'lugares', 'memorias', 'grupo']
      : ['roteiro', 'lugares', 'memorias', 'grupo']

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
            gap: theme.spacing.space4,
            paddingHorizontal: theme.spacing.space5,
            paddingTop: theme.spacing.space3,
          }}
        >
          <ScreenHeader
            testID="trip-header"
            backLabel={displayName ? `Minhas viagens · ${displayName}` : 'Minhas viagens'}
            onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            title={
              section === 'hoje'
                ? undefined
                : section === 'grupo' && memberCount !== null
                  ? `Grupo · ${memberCount}`
                  : SECTION_TITLES[section]
            }
          />
          {section === 'roteiro' && canSeeReadyToTravel && trip ? (
            <ReadyToTravelCard tripId={tripId} tripName={displayName} trip={trip} />
          ) : null}
        </View>
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
      <TabBar
        testID="viagem-abas"
        items={tabKeys.map((key) => SECTION_TABS[key])}
        currentKey={SECTION_TABS[section].key}
        onSelect={(key) => {
          const next = tabKeys.find((candidate) => SECTION_TABS[candidate].key === key)
          if (!next) return
          sectionChosenRef.current = true
          setSection(next)
        }}
      />
    </View>
  )
}
