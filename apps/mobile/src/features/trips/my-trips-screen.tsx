import { useCallback, useState } from 'react'
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button, Card, Notice, TrippyWordmark } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import {
  getTripsErrorMessage,
  useTripsClient,
  type TripPhase,
  type TripSummary,
} from './trips-client'

const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

const PHASE_LABELS: Record<TripPhase, string> = {
  planning: 'Planejando',
  traveling: 'Em viagem',
  ended: 'Encerrada',
}

function formatDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return isoDate

  return `${match[3]}/${match[2]}/${match[1]}`
}

function TripCard({ trip }: { trip: TripSummary }) {
  const theme = useTheme()

  return (
    <Card testID={`trip-card-${trip.id}`}>
      <View style={{ gap: theme.spacing.space2 }}>
        <TypographyText family="display" style={[typography.titleM, { color: theme.colors.ink }]}>
          {trip.name}
        </TypographyText>
        <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
          {trip.destination}
        </TypographyText>
        <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
          {`${formatDate(trip.startDate)} – ${formatDate(trip.endDate)}`}
        </TypographyText>
        <View
          testID="trip-card-phase"
          style={{
            alignSelf: 'flex-start',
            backgroundColor: theme.colors.forestTint,
            borderRadius: theme.radius.radiusSm,
            paddingHorizontal: theme.spacing.space3,
            paddingVertical: theme.spacing.space1,
          }}
        >
          <TypographyText family="sans" style={{ color: theme.colors.forestInk }}>
            {PHASE_LABELS[trip.phase]}
          </TypographyText>
        </View>
      </View>
    </Card>
  )
}

export function MyTripsScreen() {
  const theme = useTheme()
  const router = useRouter()
  const client = useTripsClient()
  const [trips, setTrips] = useState<TripSummary[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadTrips = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      setTrips(await client.listTrips())
    } catch (loadError) {
      setError(getTripsErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [client])

  useFocusEffect(
    useCallback(() => {
      void loadTrips()
    }, [loadTrips]),
  )

  const openNewTrip = useCallback(() => router.push('/trips/new'), [router])

  return (
    <SafeAreaView
      testID="my-trips-screen"
      style={{ flex: 1, backgroundColor: theme.colors.ground }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: theme.spacing.space5,
          padding: theme.spacing.space5,
        }}
      >
        <TrippyWordmark />
        <TypographyText family="display" style={[typography.titleL, { color: theme.colors.ink }]}>
          Minhas viagens
        </TypographyText>

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
              tone="danger"
              title="Não foi possível carregar suas viagens."
              message={error}
            />
            <Button
              label="Tentar de novo"
              onPress={() => void loadTrips()}
              testID="my-trips-retry"
            />
          </View>
        ) : trips?.length === 0 ? (
          <Card testID="my-trips-empty-card">
            <View style={{ gap: theme.spacing.space4 }}>
              <Notice
                title="Você ainda não tem viagens."
                message="Suas viagens vão aparecer aqui quando você criar uma ou aceitar um convite."
              />
              <Button
                label="Criar minha primeira viagem"
                onPress={openNewTrip}
                testID="my-trips-empty-create"
              />
            </View>
          </Card>
        ) : (
          <View style={{ gap: theme.spacing.space4 }}>
            {trips?.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
            <Button label="Nova viagem" onPress={openNewTrip} testID="my-trips-new-trip" />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
