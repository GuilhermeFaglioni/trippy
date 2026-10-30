import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, Share, View } from 'react-native'
import { useRouter } from 'expo-router'

import { canEditItinerary } from '@trippy/domain'
import type { ItineraryDay, LiveMember, LivePlace } from '@trippy/sync'
import {
  Button,
  DaySheet,
  EmptyState,
  FilterChip,
  Notice,
  PlaceListRow,
  Text,
  useTheme,
} from '../../design-system'
import { createInviteClient, getInviteErrorMessage } from '../invites/invite-client'
import { useSession } from '../auth/session-provider'
import { useSync } from '../sync/sync-provider'
import type { TripRole } from '../trips/trips-client'
import {
  comparePlacesByInterest,
  createTripDays,
  filterCounts,
  placeByline,
  placeStatusLabel,
  placeStatusTone,
  type PlaceFilter,
} from './places-list-model'

type TripPlacesScreenProps = {
  tripId: string
  tripName: string
  role: TripRole
  /** Datas da viagem (AAAA-MM-DD): definem os dias da folha "escolher dia". */
  startDate?: string
  endDate?: string
}

function toTestSlug(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'sem-nome'
}

function createTestIdByPlace(places: LivePlace[]): Map<string, string> {
  const counts = new Map<string, number>()
  return new Map(
    places.map((place) => {
      const slug = toTestSlug(place.name)
      const occurrence = (counts.get(slug) ?? 0) + 1
      counts.set(slug, occurrence)
      return [place.id, occurrence === 1 ? slug : `${slug}-${occurrence}`]
    }),
  )
}

function dayPlaceIds(places: readonly LivePlace[], dayIndex: number, skipId?: string): string[] {
  return places
    .filter((place) => place.dayIndex === dayIndex && place.id !== skipId)
    .sort(
      (left, right) =>
        (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER),
    )
    .map((place) => place.id)
}

export function TripPlacesScreen({
  tripId,
  tripName,
  role,
  startDate = '',
  endDate = '',
}: TripPlacesScreenProps) {
  const theme = useTheme()
  const router = useRouter()
  const { session, request } = useSession()
  const { client, ready } = useSync()
  const inviteClient = useMemo(() => createInviteClient(request), [request])
  const [places, setPlaces] = useState<LivePlace[]>([])
  const [members, setMembers] = useState<LiveMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [busyPlaceId, setBusyPlaceId] = useState<string | null>(null)
  const [isCreatingInvite, setIsCreatingInvite] = useState(false)
  const [screenError, setScreenError] = useState<string | null>(null)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [filter, setFilter] = useState<PlaceFilter>('all')
  const [sheetPlaceId, setSheetPlaceId] = useState<string | null>(null)

  const userId = session?.user.id ?? null
  const canArrange = canEditItinerary(role)
  const canInvite = role === 'organizer' || role === 'coorganizer'
  const days = useMemo(() => createTripDays(startDate, endDate), [startDate, endDate])
  const testIds = useMemo(() => createTestIdByPlace(places), [places])

  const rows = useMemo(
    () =>
      [...places].sort(comparePlacesByInterest).map((place, index) => ({
        place,
        tone: placeStatusTone(place, days.length, userId),
        thumbTone: ((index % 4) + 1) as 1 | 2 | 3 | 4,
      })),
    [days.length, places, userId],
  )
  const counts = useMemo(() => filterCounts(rows.map((row) => row.tone)), [rows])
  const visibleRows = rows.filter((row) => filter === 'all' || row.tone === (filter as string))
  const sheetPlace = places.find((place) => place.id === sheetPlaceId) ?? null

  const loadPlaces = useCallback(
    async (showLoading = false) => {
      if (client === null || !tripId) {
        setIsLoading(false)
        setPlaces([])
        return
      }

      // Só a primeira carga mostra spinner; sync em segundo plano atualiza no lugar.
      if (showLoading) setIsLoading(true)
      setScreenError(null)
      try {
        const [nextPlaces, nextMembers] = await Promise.all([
          client.listPlaces(tripId),
          client.listMembers(tripId),
        ])
        setPlaces(nextPlaces)
        setMembers(nextMembers)
      } catch (loadError) {
        setScreenError(
          loadError instanceof Error
            ? loadError.message
            : 'Não foi possível carregar os lugares salvos neste aparelho.',
        )
      } finally {
        setIsLoading(false)
      }
    },
    [client, tripId],
  )

  useEffect(() => {
    void loadPlaces(true)
    if (client === null) return
    return client.subscribe(() => void loadPlaces())
  }, [client, loadPlaces])

  const toggleWant = useCallback(
    async (place: LivePlace) => {
      if (client === null) return
      setBusyPlaceId(place.id)
      setScreenError(null)
      try {
        if (place.wantedByMe) await client.unwantPlace(tripId, place.id)
        else await client.wantPlace(tripId, place.id)
        await loadPlaces()
      } catch (writeError) {
        setScreenError(
          writeError instanceof Error
            ? writeError.message
            : 'Não foi possível salvar sua reação neste lugar.',
        )
      } finally {
        setBusyPlaceId(null)
      }
    },
    [client, loadPlaces, tripId],
  )

  const chooseDay = useCallback(
    async (place: LivePlace, key: string) => {
      setSheetPlaceId(null)
      if (client === null || !canArrange) return
      const target = key === 'none' ? null : Number(key)
      if (target === place.dayIndex) return
      const changed: ItineraryDay[] = []
      if (place.dayIndex !== null) {
        changed.push({
          dayIndex: place.dayIndex,
          placeIds: dayPlaceIds(places, place.dayIndex, place.id),
        })
      }
      if (target !== null) {
        changed.push({ dayIndex: target, placeIds: [...dayPlaceIds(places, target), place.id] })
      }
      setBusyPlaceId(place.id)
      setScreenError(null)
      try {
        await client.arrangeItinerary(tripId, changed)
        await loadPlaces()
      } catch (arrangeError) {
        setScreenError(
          arrangeError instanceof Error
            ? arrangeError.message
            : 'Não foi possível alterar o dia do lugar.',
        )
      } finally {
        setBusyPlaceId(null)
      }
    },
    [canArrange, client, loadPlaces, places, tripId],
  )

  const createInvite = useCallback(async () => {
    setInviteError(null)
    setIsCreatingInvite(true)
    try {
      setInviteCode(await inviteClient.create(tripId))
    } catch (createError) {
      setInviteError(getInviteErrorMessage(createError))
    } finally {
      setIsCreatingInvite(false)
    }
  }, [inviteClient, tripId])

  const shareInvite = useCallback(async () => {
    if (inviteCode === null) return
    await Share.share({ message: `Entre em ${tripName} com este código: ${inviteCode}` })
  }, [inviteCode, tripName])

  const openAddPlace = () =>
    router.push({
      pathname: '/trips/[id]/add-place',
      params: { id: tripId, tripName, role },
    })

  const notices = (
    <>
      {!ready || isLoading ? (
        <View accessibilityRole="progressbar" testID="trip-places-loading">
          <ActivityIndicator color={theme.colors.forest} />
        </View>
      ) : null}
      {screenError ? (
        <Notice testID="trip-places-error" tone="change" segments={[screenError]} />
      ) : null}
    </>
  )

  if (!isLoading && places.length === 0) {
    return (
      <View
        testID="trip-detail-screen"
        style={{
          flex: 1,
          gap: 14,
          paddingBottom: theme.spacing.space5,
          paddingHorizontal: theme.spacing.space5,
        }}
      >
        {notices}
        <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center' }}>
          <EmptyState
            testID="places-empty"
            icon="map-pin"
            title="Nenhum lugar ainda"
            message="Adicione o primeiro lugar ou convide o grupo para sugerir."
          />
        </View>
        <Button
          label="Adicionar lugar"
          onPress={openAddPlace}
          disabled={client === null}
          testID="add-place-button"
        />
        {canInvite ? (
          <View style={{ gap: theme.spacing.space3 }}>
            {inviteError ? (
              <Notice testID="trip-invite-error" tone="change" segments={[inviteError]} />
            ) : null}
            {inviteCode ? (
              <View testID="invite-code" style={{ gap: theme.spacing.space2 }}>
                <Text variant="fieldHelp" color={theme.colors.inkMuted}>
                  Código do convite
                </Text>
                <Text
                  variant="titleM"
                  color={theme.colors.ink}
                  selectable
                  testID="invite-code-value"
                >
                  {inviteCode}
                </Text>
                <Button
                  label="Compartilhar código"
                  onPress={() => void shareInvite()}
                  variant="secondary"
                  block
                  testID="share-trip-invite"
                />
              </View>
            ) : (
              <Button
                label="Convidar pessoas"
                onPress={() => void createInvite()}
                variant="secondary"
                block
                loading={isCreatingInvite}
                testID="create-trip-invite"
              />
            )}
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <View testID="trip-detail-screen" style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          gap: theme.spacing.space3,
          paddingBottom: 96,
          paddingHorizontal: theme.spacing.space5,
        }}
      >
        {notices}
        <View style={{ flexDirection: 'row', gap: theme.spacing.space2 }}>
          <FilterChip
            testID="places-filter-all"
            label={`Todos ${counts.all}`}
            selected={filter === 'all'}
            onPress={() => setFilter('all')}
          />
          <FilterChip
            testID="places-filter-suggested"
            label={`Sugeridos ${counts.suggested}`}
            selected={filter === 'suggested'}
            onPress={() => setFilter('suggested')}
          />
          <FilterChip
            testID="places-filter-none"
            label={`Sem dia ${counts.none}`}
            selected={filter === 'none'}
            onPress={() => setFilter('none')}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: theme.spacing.space1 }}>
          <Text variant="notice" color={theme.colors.inkMuted}>
            Ordenado por
          </Text>
          <Text variant="filterSelected" color={theme.colors.ink}>
            mais "quero ir"
          </Text>
        </View>
        {visibleRows.map(({ place, tone, thumbTone }) => {
          const slug = testIds.get(place.id) ?? toTestSlug(place.name)
          return (
            <PlaceListRow
              key={place.id}
              testID={`place-${slug}`}
              name={place.name}
              byline={placeByline(place, userId, members)}
              thumbTone={thumbTone}
              status={{
                tone,
                label: placeStatusLabel(tone, place, canArrange),
                onPress:
                  canArrange && days.length > 0 ? () => setSheetPlaceId(place.id) : undefined,
              }}
              want={{
                count: place.wantCount,
                marked: place.wantedByMe,
                disabled: busyPlaceId === place.id,
                onToggle: () => void toggleWant(place),
              }}
              onPress={() =>
                router.push({
                  pathname: '/trips/[id]/places/[placeId]',
                  params: { id: tripId, placeId: place.id },
                })
              }
            />
          )
        })}
      </ScrollView>
      <View
        pointerEvents="box-none"
        style={{ bottom: theme.spacing.space5, position: 'absolute', right: theme.spacing.space5 }}
      >
        <Button
          label="+ Lugar"
          variant="fab"
          onPress={openAddPlace}
          disabled={client === null}
          testID="add-place-button"
        />
      </View>
      <DaySheet
        visible={sheetPlace !== null}
        title="Escolher dia"
        options={[
          ...days.map((day) => ({
            key: String(day.dayIndex),
            label: day.label,
            selected: sheetPlace?.dayIndex === day.dayIndex,
          })),
          ...(sheetPlace?.dayIndex != null
            ? [{ key: 'none', label: 'Sem dia', selected: false }]
            : []),
        ]}
        onSelect={(key) => sheetPlace && void chooseDay(sheetPlace, key)}
        onClose={() => setSheetPlaceId(null)}
        testID="places-day-sheet"
      />
    </View>
  )
}
