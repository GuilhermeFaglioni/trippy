import { useCallback, useState } from 'react'
import { ActivityIndicator, ScrollView, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  Avatar,
  Button,
  DecorTile,
  HighlightCard,
  MemoryTile,
  Notice,
  StatusChip,
  Text,
  TextButton,
  TripRow,
  TrippyLogo,
  useTheme,
  withAlpha,
  type TripCoverTone,
} from '../../design-system'
import { useSession } from '../auth/session-provider'
import { AcceptInviteForm } from '../invites/accept-invite-form'
import { useSync } from '../sync/sync-provider'
import { formatDateRange, formatMonthYear, formatTripDay } from './trip-format'
import { getTripsErrorMessage, useTripsClient, type TripSummary } from './trips-client'

function withoutRemovedTrips(
  trips: readonly TripSummary[],
  removedTripIds: readonly string[],
): TripSummary[] {
  const removed = new Set(removedTripIds)
  return trips.filter((trip) => !removed.has(trip.id))
}

function coverTone(index: number): TripCoverTone {
  return ((index % 4) + 1) as TripCoverTone
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme()

  return (
    <View style={{ gap: 10 }}>
      <Text variant="label" color={theme.colors.inkMuted} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  )
}

function HighlightTrip({ trip, onOpen }: { trip: TripSummary; onOpen: () => void }) {
  const theme = useTheme()
  const onForest = theme.colors.onForest

  return (
    <HighlightCard
      testID={`trip-card-${trip.id}`}
      style={{
        borderRadius: theme.radius.radiusLg,
        gap: 0,
        justifyContent: 'space-between',
        minHeight: 260,
        overflow: 'hidden',
        padding: theme.spacing.space5,
      }}
    >
      <View style={{ position: 'absolute', right: -40, top: -40 }}>
        <DecorTile color={withAlpha(onForest, 0.1)} width={200} height={200} radius={100} />
      </View>
      <StatusChip
        tone="live"
        label={`Em viagem · ${formatTripDay(trip)}`}
        testID="trip-card-phase"
      />
      <View>
        <Text
          variant="titleM"
          color={onForest}
          accessibilityRole="header"
          style={{ fontSize: 30, letterSpacing: -0.5, lineHeight: 34 }}
        >
          {trip.name}
        </Text>
        <Text variant="bodySm" color={withAlpha(onForest, 0.8)} style={{ marginTop: 4 }}>
          {`${trip.destination} · ${formatDateRange(trip.startDate, trip.endDate)}`}
        </Text>
        <View style={{ marginTop: theme.spacing.space4 }}>
          <Button
            label="Abrir Hoje"
            variant="inverse"
            block={false}
            onPress={onOpen}
            accessibilityLabel={`Abrir Hoje de ${trip.name}`}
            testID={`trip-open-${trip.id}`}
          />
        </View>
      </View>
    </HighlightCard>
  )
}

export function MyTripsScreen() {
  const theme = useTheme()
  const router = useRouter()
  const client = useTripsClient()
  const { session } = useSession()
  const { client: syncClient, rememberTripIds, removedTrips } = useSync()
  const [trips, setTrips] = useState<TripSummary[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)

  const loadTrips = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const loadedTrips = await client.listTrips()
      const removedTripIds =
        syncClient === null ? [] : await syncClient.listRemovedTrips().catch(() => [])
      const availableTrips = withoutRemovedTrips(loadedTrips, removedTripIds)
      rememberTripIds(availableTrips.map((trip) => trip.id))
      setTrips(availableTrips)
      if (syncClient !== null) void syncClient.syncNow().catch(() => undefined)
    } catch (loadError) {
      setError(getTripsErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [client, rememberTripIds, syncClient])

  useFocusEffect(
    useCallback(() => {
      void loadTrips()
    }, [loadTrips]),
  )

  const visibleTrips = trips === null ? null : withoutRemovedTrips(trips, removedTrips)
  const traveling = visibleTrips?.filter((trip) => trip.phase === 'traveling') ?? []
  const planning = visibleTrips?.filter((trip) => trip.phase === 'planning') ?? []
  const ended = visibleTrips?.filter((trip) => trip.phase === 'ended') ?? []
  const [current, ...otherTraveling] = traveling
  const isEmpty = visibleTrips?.length === 0

  const openNewTrip = useCallback(() => router.push('/trips/new'), [router])
  const openTrip = useCallback(
    (trip: TripSummary) =>
      router.push({
        pathname: '/trips/[id]',
        params: {
          id: trip.id,
          tripName: trip.name,
          role: trip.role,
          startDate: trip.startDate,
          endDate: trip.endDate,
        },
      }),
    [router],
  )

  const accountName = session?.user.name ?? session?.user.email.split('@')[0] ?? 'Conta'

  const rows = (list: TripSummary[], offset: number) => (
    <View style={{ gap: theme.spacing.space3 }}>
      {list.map((trip, index) => (
        <TripRow
          key={trip.id}
          testID={`trip-card-${trip.id}`}
          title={trip.name}
          meta={
            trip.phase === 'traveling'
              ? `${trip.destination} · ${formatDateRange(trip.startDate, trip.endDate)}`
              : `${formatMonthYear(trip.startDate)} · ${trip.destination}`
          }
          cover={coverTone(offset + index)}
          onPress={() => openTrip(trip)}
        />
      ))}
    </View>
  )

  return (
    <SafeAreaView
      testID="my-trips-screen"
      style={{ flex: 1, backgroundColor: theme.colors.ground }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: theme.spacing.space5,
          paddingBottom: theme.spacing.space4,
          paddingHorizontal: theme.spacing.space5,
          paddingTop: theme.spacing.space1,
        }}
      >
        <View
          style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }}
        >
          <TrippyLogo testID="trippy-wordmark" />
          <Avatar name={accountName} color={1} testID="my-trips-avatar" />
        </View>

        {isLoading ? (
          <View
            testID="my-trips-loading"
            accessibilityRole="progressbar"
            accessibilityLabel="Carregando viagens"
            style={{ alignItems: 'center', padding: theme.spacing.space5 }}
          >
            <ActivityIndicator color={theme.colors.forest} />
          </View>
        ) : error !== null ? (
          <View style={{ gap: theme.spacing.space4 }}>
            <Notice
              testID="my-trips-error"
              tone="change"
              segments={[{ strong: 'Não foi possível carregar suas viagens.' }, ' ', error]}
            />
            <Button
              label="Tentar de novo"
              onPress={() => void loadTrips()}
              testID="my-trips-retry"
            />
          </View>
        ) : isEmpty ? (
          <View
            testID="my-trips-empty-card"
            style={{ flex: 1, gap: theme.spacing.space4, justifyContent: 'center' }}
          >
            <View style={{ flexDirection: 'row', gap: theme.spacing.space2 }}>
              <DecorTile
                color={theme.colors.photo1}
                width={80}
                height={104}
                radius={18}
                rotate={-6}
              />
              <DecorTile
                color={theme.colors.photo2}
                width={80}
                height={104}
                radius={18}
                rotate={4}
                offsetY={12}
              />
            </View>
            <Text
              variant="titleL"
              color={theme.colors.ink}
              accessibilityRole="header"
              style={{ lineHeight: 35, marginTop: theme.spacing.space4 }}
            >
              Sua primeira viagem começa aqui
            </Text>
            <Text variant="body" color={theme.colors.inkMuted}>
              Crie a viagem, chame o grupo e comecem a sugerir lugares. Se alguém te mandou um
              convite, abra o link que ele te leva direto.
            </Text>
          </View>
        ) : (
          <>
            <Text variant="titleL" color={theme.colors.ink} accessibilityRole="header">
              Minhas viagens
            </Text>
            {current ? <HighlightTrip trip={current} onOpen={() => openTrip(current)} /> : null}
            {otherTraveling.length > 0 ? (
              <Section title="Em viagem">{rows(otherTraveling, 1)}</Section>
            ) : null}
            {planning.length > 0 ? <Section title="Planejando">{rows(planning, 1)}</Section> : null}
            {ended.length > 0 ? (
              <Section title="Memórias">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {ended.map((trip, index) => (
                    <View key={trip.id} style={{ flexBasis: '47%', flexGrow: 1 }}>
                      <MemoryTile
                        testID={`trip-card-${trip.id}`}
                        title={trip.name}
                        cover={index % 2 === 0 ? 1 : 4}
                        onPress={() => openTrip(trip)}
                      />
                    </View>
                  ))}
                </View>
              </Section>
            ) : null}
          </>
        )}

        {showInvite ? (
          <AcceptInviteForm />
        ) : (
          <TextButton
            label="Tenho um código de convite"
            onPress={() => setShowInvite(true)}
            testID="my-trips-show-invite"
          />
        )}

        <View style={{ flexGrow: 1 }} />
        {error === null && !isLoading ? (
          <Button
            label={isEmpty ? 'Criar minha primeira viagem' : '+ Nova viagem'}
            onPress={openNewTrip}
            testID={isEmpty ? 'my-trips-empty-create' : 'my-trips-new-trip'}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
