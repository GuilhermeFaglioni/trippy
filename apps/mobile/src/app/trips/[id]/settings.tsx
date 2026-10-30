import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ActionSheet, Button, Card, ScreenHeader, Text } from '../../../design-system/components'
import { useTheme } from '../../../design-system'
import { useSync } from '../../../features/sync/sync-provider'
import { loadTripSummary, saveTripSummary } from '../../../features/trips/trip-summary-cache'
import { useTripsClient, type TripSummary } from '../../../features/trips/trips-client'

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

/** "2026-10-12", "2026-10-24" → "12–24 out". */
export function formatDateRange(startDate: string, endDate: string): string {
  const [, startMonth, startDay] = startDate.split('-').map(Number)
  const [, endMonth, endDay] = endDate.split('-').map(Number)
  if (!startMonth || !startDay || !endMonth || !endDay) return ''
  if (startMonth === endMonth) return `${startDay}–${endDay} ${MONTHS[endMonth - 1]}`
  return `${startDay} ${MONTHS[startMonth - 1]}–${endDay} ${MONTHS[endMonth - 1]}`
}

function formatDay(isoDate: string): string {
  const [, month, day] = isoDate.split('-').map(Number)
  return month && day ? `${day}/${MONTHS[month - 1]}` : isoDate
}

function todayLabel(): string {
  const now = new Date()
  return `${now.getDate()}/${MONTHS[now.getMonth()]}`
}

/** Ajustes da viagem e encerramento (`24-encerrar-viagem-editar-datas`). */
export default function TripSettingsRoute() {
  const params = useLocalSearchParams<{
    id?: string | string[]
    tripName?: string | string[]
    role?: string | string[]
  }>()
  const { colors, spacing } = useTheme()
  const { client } = useSync()
  const tripsClient = useTripsClient()
  const tripId = firstParam(params.id)
  const tripName = firstParam(params.tripName)
  const role = firstParam(params.role)
  const [trip, setTrip] = useState<TripSummary | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [ended, setEnded] = useState(false)

  useEffect(() => {
    let active = true
    void tripsClient
      .listTrips()
      .then((trips) => {
        const found = trips.find((candidate) => candidate.id === tripId) ?? null
        if (active) setTrip(found)
      })
      .catch(async () => {
        const cached = await loadTripSummary(tripId)
        if (active) setTrip(cached)
      })
    return () => {
      active = false
    }
  }, [tripsClient, tripId])

  const name = trip?.name ?? tripName
  const canEnd = role === 'organizer' && !ended && trip?.phase !== 'ended'
  const phaseLabel =
    ended || trip?.phase === 'ended'
      ? 'Encerrada'
      : trip?.phase === 'traveling'
        ? 'Em viagem'
        : 'Planejando'

  async function endTrip() {
    if (client === null) return
    setSheetOpen(false)
    await client.endTrip(tripId)
    setEnded(true)
    if (trip) void saveTripSummary({ ...trip, phase: 'ended' })
  }

  return (
    <SafeAreaView testID="trip-settings" style={{ flex: 1, backgroundColor: colors.ground }}>
      <View style={{ gap: spacing.space4, padding: spacing.space5, paddingTop: spacing.space6 }}>
        <View style={{ gap: spacing.space1 }}>
          <Text variant="backLink" color={colors.inkMuted} testID="trip-header-phase">
            {`${name || 'Viagem'} · ${phaseLabel}`}
          </Text>
          <ScreenHeader title="Ajustes da viagem" />
        </View>
        <Card>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Datas"
            disabled={!canEnd}
            onPress={() => setSheetOpen(true)}
            testID="trip-end-button"
            style={{
              alignItems: 'center',
              borderBottomColor: colors.line,
              borderBottomWidth: 1,
              flexDirection: 'row',
              height: 54,
              justifyContent: 'space-between',
            }}
          >
            <Text variant="body" color={colors.ink}>
              Datas
            </Text>
            <Text variant="body" color={colors.inkMuted}>
              {trip ? formatDateRange(trip.startDate, trip.endDate) : ''}
            </Text>
          </Pressable>
          <View
            style={{
              alignItems: 'center',
              flexDirection: 'row',
              height: 54,
              justifyContent: 'space-between',
            }}
          >
            <Text variant="body" color={colors.ink}>
              Capa
            </Text>
            <Text variant="body" color={colors.inkMuted}>
              Alterar
            </Text>
          </View>
        </Card>
      </View>

      <ActionSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} testID="trip-end-sheet">
        <Text variant="titleM" color={colors.ink}>
          Encerrar a viagem hoje?
        </Text>
        <Text variant="body" color={colors.ink}>
          {`A viagem estava marcada até ${trip ? formatDay(trip.endDate) : ''}. Ao encerrar:`}
        </Text>
        <View style={{ gap: spacing.space1 }}>
          {[
            `a data de volta muda para hoje, ${todayLabel()};`,
            'o recap começa a ser gerado e o grupo é avisado;',
            'fotos que chegarem depois entram no álbum, e você pode gerar o recap de novo.',
          ].map((line) => (
            <View key={line} style={{ flexDirection: 'row', gap: spacing.space2 }}>
              <Text variant="body" color={colors.ink}>
                •
              </Text>
              <Text variant="body" color={colors.ink} style={{ flex: 1 }}>
                {line}
              </Text>
            </View>
          ))}
        </View>
        <Button
          label="Encerrar e gerar recap"
          onPress={() => void endTrip()}
          testID="trip-end-confirm"
        />
        <Button
          label="Só editar as datas"
          variant="secondary"
          block
          onPress={() => setSheetOpen(false)}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => setSheetOpen(false)}
          style={{ alignItems: 'center', minHeight: spacing.targetMin, justifyContent: 'center' }}
        >
          <Text variant="button" color={colors.ink}>
            Cancelar
          </Text>
        </Pressable>
      </ActionSheet>
    </SafeAreaView>
  )
}
