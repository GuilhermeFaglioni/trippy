import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native'

import { canEditItinerary } from '@trippy/domain'
import type { ItineraryDay, ItineraryDraft, LivePlace } from '@trippy/sync'
import { Button, Card, Notice } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import {
  Button as DsButton,
  DashedButton,
  DaySheet,
  DayPicker,
  Notice as DsNotice,
  ReorderableList,
  STOP_ROW_HEIGHT,
  StopCard,
  Text,
} from '../../design-system/components'
import { useSession } from '../auth/session-provider'
import { useSync } from '../sync/sync-provider'

/** TestIDs Maestro: roteiro-dia-<índice>, roteiro-lugar-<slug>(-mover-dia), seletor-dia-<índice>, conflito-roteiro. */
const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

type TripDay = { dayIndex: number; date: string; label: string; short: string }

type ItineraryScreenProps = {
  tripId: string
  startDate: string
  endDate: string
  /** "Escolher em Lugares" e "Adicionar lugar ao dia" sem lugares soltos levam à aba Lugares. */
  onOpenPlaces?: () => void
  /** Abre o detalhe do lugar. */
  onOpenPlace?: (placeId: string) => void
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date
}

function formatDate(value: string): string {
  const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value) ?? []
  return year && month && day ? `${day}/${month}/${year}` : value
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** "qua 14/out", como no título do dia. */
function formatShort(date: Date): string {
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()}/${MONTHS[date.getUTCMonth()]}`
}

function createTripDays(startDate: string, endDate: string): TripDay[] {
  const start = parseIsoDate(startDate)
  const end = parseIsoDate(endDate)
  if (start === null || end === null || end < start) return []

  const days: TripDay[] = []
  const current = new Date(start)
  while (current <= end && days.length <= 365) {
    const date = current.toISOString().slice(0, 10)
    days.push({ dayIndex: days.length, date, label: formatDate(date), short: formatShort(current) })
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return days
}

function testSlug(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
  return slug || 'sem-nome'
}

function placeDayIndex(place: LivePlace, dayCount: number): number | null {
  return place.dayIndex !== null && place.dayIndex >= 0 && place.dayIndex < dayCount
    ? place.dayIndex
    : null
}

function placesForDay(
  places: readonly LivePlace[],
  dayIndex: number,
  dayCount: number,
): LivePlace[] {
  return places
    .filter((place) => placeDayIndex(place, dayCount) === dayIndex)
    .sort(
      (left, right) =>
        (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER),
    )
}

function changedPlaceIds(draft: readonly string[], current: readonly string[]): Set<string> {
  const changed = new Set<string>()
  for (let index = 0; index < Math.max(draft.length, current.length); index += 1) {
    if (draft[index] !== current[index]) {
      if (draft[index] !== undefined) changed.add(draft[index]!)
      if (current[index] !== undefined) changed.add(current[index]!)
    }
  }
  return changed
}

function PlaceNames({
  ids,
  names,
  changedIds,
  side,
}: {
  ids: readonly string[]
  names: ReadonlyMap<string, string>
  changedIds: ReadonlySet<string>
  side: 'rascunho' | 'atual'
}) {
  const theme = useTheme()
  if (ids.length === 0) {
    return (
      <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
        Dia sem lugares
      </TypographyText>
    )
  }

  return (
    <View style={{ gap: theme.spacing.space2 }}>
      {ids.map((id, index) => {
        const changed = changedIds.has(id)
        return (
          <View
            key={`${side}-${id}-${index}`}
            testID={`conflito-roteiro-${side}-${testSlug(names.get(id) ?? id)}`}
            style={{
              backgroundColor: changed
                ? side === 'rascunho'
                  ? theme.colors.terracottaTint
                  : theme.colors.forestTint
                : 'transparent',
              borderRadius: theme.radius.radiusSm,
              padding: theme.spacing.space2,
            }}
          >
            <TypographyText family="sans" style={{ color: theme.colors.ink }}>
              {`${index + 1}. ${names.get(id) ?? 'Lugar indisponível'}${changed ? ' · alterado' : ''}`}
            </TypographyText>
          </View>
        )
      })}
    </View>
  )
}

function ItineraryConflict({
  draft,
  days,
  names,
  currentByDay,
  canManage,
  busy,
  onDiscard,
  onReapply,
}: {
  draft: ItineraryDraft
  days: readonly TripDay[]
  names: ReadonlyMap<string, string>
  currentByDay: ReadonlyMap<number, string[]>
  canManage: boolean
  busy: boolean
  onDiscard: () => void
  onReapply: () => void
}) {
  const theme = useTheme()
  const dayLabels = new Map(days.map((day) => [day.dayIndex, day.label]))

  return (
    <Card testID={`conflito-roteiro-${draft.opId}`}>
      <View style={{ gap: theme.spacing.space3 }}>
        <Notice
          testID="conflito-roteiro"
          tone="warning"
          title="Seu rascunho do roteiro não foi aplicado: outra pessoa mudou o roteiro antes."
          message="Compare seu rascunho com o roteiro atual antes de escolher como continuar."
        />
        {draft.days.map((day) => {
          const current = currentByDay.get(day.dayIndex) ?? []
          const changed = changedPlaceIds(day.placeIds, current)
          return (
            <View
              key={day.dayIndex}
              testID={`conflito-roteiro-dia-${day.dayIndex}`}
              style={{ gap: theme.spacing.space2 }}
            >
              <TypographyText
                family="display"
                style={[typography.titleM, { color: theme.colors.ink }]}
              >
                {`Dia ${day.dayIndex + 1}${dayLabels.has(day.dayIndex) ? ` · ${dayLabels.get(day.dayIndex)}` : ''}`}
              </TypographyText>
              <View style={{ flexDirection: 'row', gap: theme.spacing.space2 }}>
                <View style={{ flex: 1, gap: theme.spacing.space2 }}>
                  <TypographyText family="sans" style={{ color: theme.colors.terracottaInk }}>
                    Seu rascunho
                  </TypographyText>
                  <PlaceNames
                    ids={day.placeIds}
                    names={names}
                    changedIds={changed}
                    side="rascunho"
                  />
                </View>
                <View style={{ flex: 1, gap: theme.spacing.space2 }}>
                  <TypographyText family="sans" style={{ color: theme.colors.forestInk }}>
                    Roteiro atual
                  </TypographyText>
                  <PlaceNames ids={current} names={names} changedIds={changed} side="atual" />
                </View>
              </View>
            </View>
          )
        })}
        {canManage ? (
          <View style={{ gap: theme.spacing.space2 }}>
            <Button
              label="Usar o roteiro atual"
              variant="secondary"
              disabled={busy}
              onPress={onDiscard}
              testID={`conflito-roteiro-descartar-${draft.opId}`}
            />
            <Button
              label="Aplicar meu rascunho de novo"
              disabled={busy}
              onPress={onReapply}
              testID={`conflito-roteiro-reaplicar-${draft.opId}`}
            />
          </View>
        ) : null}
      </View>
    </Card>
  )
}

type MoveTarget = { place: LivePlace; dayIndex: number }

function stopMeta(place: LivePlace): string {
  const parts: string[] = []
  if (place.wantCount > 0)
    parts.push(place.wantCount === 1 ? '1 quer ir' : `${place.wantCount} querem ir`)
  if (place.localAddressStatus === 'missing') parts.push('Sem endereço em chinês')
  return parts.length > 0 ? parts.join(' · ') : (place.address ?? 'Sem detalhes ainda')
}

export function ItineraryScreen({
  tripId,
  startDate,
  endDate,
  onOpenPlaces,
  onOpenPlace,
}: ItineraryScreenProps) {
  const theme = useTheme()
  const { session } = useSession()
  const { client } = useSync()
  const days = useMemo(() => createTripDays(startDate, endDate), [endDate, startDate])
  const [places, setPlaces] = useState<LivePlace[]>([])
  const [members, setMembers] = useState<
    Awaited<ReturnType<NonNullable<typeof client>['listMembers']>>
  >([])
  const [drafts, setDrafts] = useState<ItineraryDraft[]>([])
  const [selected, setSelected] = useState<number | 'all' | null>(null)
  const [moving, setMoving] = useState<MoveTarget | null>(null)
  const [adding, setAdding] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [optimistic, setOptimistic] = useState<Map<number, string[]>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const viewerRole = members.find((member) => member.userId === session?.user.id)?.role ?? 'member'
  const canEdit = canEditItinerary(viewerRole)

  const loadData = useCallback(
    async (showLoading = false) => {
      if (client === null || !tripId) {
        setIsLoading(false)
        setPlaces([])
        setMembers([])
        setDrafts([])
        return
      }

      if (showLoading) setIsLoading(true)
      setError(null)
      try {
        const [nextPlaces, nextMembers, nextDrafts] = await Promise.all([
          client.listPlaces(tripId),
          client.listMembers(tripId),
          client.listItineraryDrafts(tripId),
        ])
        setPlaces(nextPlaces)
        setMembers(nextMembers)
        setDrafts(nextDrafts)
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Não foi possível carregar o roteiro salvo neste aparelho.',
        )
      } finally {
        if (showLoading) setIsLoading(false)
      }
    },
    [client, tripId],
  )

  useEffect(() => {
    void loadData(true)
    if (client === null) return
    return client.subscribe(() => void loadData())
  }, [client, loadData])

  const arrange = useCallback(
    async (changedDays: ItineraryDay[]) => {
      if (client === null || !canEdit) return
      setBusy(true)
      setError(null)
      setOptimistic(new Map(changedDays.map((day) => [day.dayIndex, day.placeIds])))
      try {
        await client.arrangeItinerary(tripId, changedDays)
        await loadData()
      } catch (arrangeError) {
        setError(
          arrangeError instanceof Error
            ? arrangeError.message
            : 'Não foi possível alterar o roteiro.',
        )
      } finally {
        setOptimistic(new Map())
        setBusy(false)
      }
    },
    [canEdit, client, loadData, tripId],
  )

  const dayPlaces = useCallback(
    (dayIndex: number): LivePlace[] => {
      const current = placesForDay(places, dayIndex, days.length)
      const order = optimistic.get(dayIndex)
      if (!order) return current
      const byId = new Map(current.map((place) => [place.id, place]))
      const ordered = order.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
      return ordered.length === current.length ? ordered : current
    },
    [days.length, optimistic, places],
  )

  const reorderDay = useCallback(
    (dayIndex: number, next: LivePlace[]) => {
      void arrange([{ dayIndex, placeIds: next.map((place) => place.id) }])
    },
    [arrange],
  )

  const moveToDay = useCallback(
    (target: MoveTarget, destination: number | 'none') => {
      const { place, dayIndex: sourceDay } = target
      const rest = placesForDay(places, sourceDay, days.length)
        .filter((candidate) => candidate.id !== place.id)
        .map((candidate) => candidate.id)
      const source = { dayIndex: sourceDay, placeIds: rest }
      if (destination === 'none') return void arrange([source])
      const targetIds = placesForDay(places, destination, days.length).map(
        (candidate) => candidate.id,
      )
      void arrange([source, { dayIndex: destination, placeIds: [...targetIds, place.id] }])
    },
    [arrange, days.length, places],
  )

  const addToDay = useCallback(
    (dayIndex: number, placeId: string) => {
      const ids = placesForDay(places, dayIndex, days.length).map((candidate) => candidate.id)
      void arrange([{ dayIndex, placeIds: [...ids, placeId] }])
    },
    [arrange, days.length, places],
  )

  const handleDraft = useCallback(
    async (draft: ItineraryDraft, action: 'discard' | 'reapply') => {
      if (client === null) return
      setBusy(true)
      setError(null)
      try {
        if (action === 'discard') await client.discardItineraryDraft(draft.opId)
        else await client.reapplyItineraryDraft(draft.opId)
        await loadData()
      } catch (draftError) {
        setError(
          draftError instanceof Error
            ? draftError.message
            : 'Não foi possível atualizar o rascunho do roteiro.',
        )
      } finally {
        setBusy(false)
      }
    },
    [client, loadData],
  )

  const placeNames = useMemo(() => new Map(places.map((place) => [place.id, place.name])), [places])
  const currentByDay = useMemo(
    () =>
      new Map(
        days.map((day) => [
          day.dayIndex,
          placesForDay(places, day.dayIndex, days.length).map((place) => place.id),
        ]),
      ),
    [days, places],
  )
  const unscheduled = places.filter((place) => placeDayIndex(place, days.length) === null)

  // Sem escolha, abre no primeiro dia que já tem lugares.
  const activeDay: number | 'all' =
    selected ?? days.find((day) => currentByDay.get(day.dayIndex)!.length > 0)?.dayIndex ?? 0
  const visibleDays = activeDay === 'all' ? days : days.filter((day) => day.dayIndex === activeDay)

  const renderDay = (day: TripDay) => {
    const stops = dayPlaces(day.dayIndex)
    const title = `Dia ${day.dayIndex + 1} · ${day.short}`

    return (
      <View key={day.dayIndex} testID={`roteiro-dia-${day.dayIndex}`} style={{ gap: 12 }}>
        <Text variant="titleM" color={theme.colors.ink} accessibilityRole="header">
          {title}
        </Text>
        {stops.length === 0 ? (
          <View
            testID={`roteiro-dia-livre-${day.dayIndex}`}
            style={{
              alignItems: 'center',
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.radiusLg,
              gap: 10,
              marginTop: 12,
              paddingHorizontal: 20,
              paddingVertical: 28,
            }}
          >
            <View
              style={{
                backgroundColor: theme.colors.mustard,
                borderRadius: theme.radius.radiusPill,
                height: 64,
                width: 64,
              }}
            />
            <Text variant="titleM" color={theme.colors.ink}>
              Dia livre
            </Text>
            <Text variant="body" color={theme.colors.inkMuted}>
              Quer adicionar algum lugar?
            </Text>
            <View style={{ alignSelf: 'center', marginTop: 6 }}>
              <DsButton
                label="Escolher em Lugares"
                variant="secondary"
                onPress={() => onOpenPlaces?.()}
                testID={`roteiro-dia-${day.dayIndex}-escolher`}
              />
            </View>
          </View>
        ) : (
          <ReorderableList
            items={stops}
            keyOf={(place) => place.id}
            rowHeight={STOP_ROW_HEIGHT}
            enabled={canEdit && !busy}
            onReorder={(next) => reorderDay(day.dayIndex, next)}
            onDragChange={setDragging}
            renderItem={(place, drag) => (
              <StopCard
                testID={`roteiro-lugar-${testSlug(place.name)}`}
                number={drag.index + 1}
                name={place.name}
                meta={stopMeta(place)}
                last={drag.index === stops.length - 1}
                editable={canEdit}
                drag={drag}
                onPress={onOpenPlace ? () => onOpenPlace(place.id) : undefined}
                onMoveDay={() => setMoving({ place, dayIndex: day.dayIndex })}
              />
            )}
          />
        )}
        {canEdit ? (
          <DashedButton
            label="+ Adicionar lugar ao dia"
            inset={stops.length > 0 ? 40 : 0}
            onPress={() => (unscheduled.length > 0 ? setAdding(day.dayIndex) : onOpenPlaces?.())}
            testID={`roteiro-dia-${day.dayIndex}-adicionar`}
          />
        ) : null}
      </View>
    )
  }

  const moveOptions = moving
    ? [
        ...days
          .filter((day) => day.dayIndex !== moving.dayIndex)
          .map((day) => {
            const count = currentByDay.get(day.dayIndex)!.length
            return {
              key: `dia-${day.dayIndex}`,
              label: `Dia ${day.dayIndex + 1} · ${day.short} · ${count === 0 ? 'dia livre' : count === 1 ? '1 lugar' : `${count} lugares`}`,
            }
          }),
        { key: 'sem-dia', label: 'Tirar do roteiro (fica sem dia)' },
      ]
    : []

  return (
    <ScrollView
      testID="tela-roteiro"
      scrollEnabled={!dragging}
      contentContainerStyle={{ gap: theme.spacing.space4, padding: theme.spacing.space5 }}
      keyboardShouldPersistTaps="handled"
    >
      {error ? <Notice testID="roteiro-erro" tone="danger" message={error} /> : null}
      {isLoading ? (
        <View
          accessibilityRole="progressbar"
          testID="roteiro-carregando"
          style={{ alignItems: 'center' }}
        >
          <ActivityIndicator color={theme.colors.forest} />
        </View>
      ) : null}
      {days.length === 0 ? (
        <Notice
          testID="roteiro-datas-invalidas"
          tone="warning"
          message="As datas desta viagem não permitem montar os dias do roteiro."
        />
      ) : null}

      {!canEdit && !isLoading ? (
        <DsNotice
          testID="roteiro-somente-leitura"
          tone="offline"
          segments={[
            'Só o organizador e os coorganizadores mudam o roteiro. Sugira lugares na aba Lugares.',
          ]}
        />
      ) : null}

      {drafts.map((draft) => (
        <ItineraryConflict
          key={draft.opId}
          draft={draft}
          days={days}
          names={placeNames}
          currentByDay={currentByDay}
          canManage={canEdit}
          busy={busy}
          onDiscard={() => void handleDraft(draft, 'discard')}
          onReapply={() => void handleDraft(draft, 'reapply')}
        />
      ))}

      {days.length > 0 ? (
        <DayPicker
          testID="seletor-dia"
          days={days.map((day) => ({ key: String(day.dayIndex), number: day.dayIndex + 1 }))}
          selectedKey={activeDay === 'all' ? null : String(activeDay)}
          allLabel={`Todos os ${days.length} dias`}
          allSelected={activeDay === 'all'}
          onSelect={(key) => setSelected(Number(key))}
          onSelectAll={() => setSelected('all')}
        />
      ) : null}

      {visibleDays.map(renderDay)}

      {unscheduled.length > 0 && days.length > 0 ? (
        <Text
          testID="roteiro-lugares-sem-dia"
          variant="placeAddress"
          color={theme.colors.inkMuted}
          style={{ textAlign: 'center' }}
        >
          {unscheduled.length === 1
            ? '1 lugar do grupo ainda está sem dia.'
            : `${unscheduled.length} lugares do grupo ainda estão sem dia.`}
        </Text>
      ) : null}

      <DaySheet
        visible={moving !== null}
        title={moving ? `Mover "${moving.place.name}" para` : ''}
        options={moveOptions}
        onClose={() => setMoving(null)}
        onSelect={(key) => {
          const target = moving
          setMoving(null)
          if (target) moveToDay(target, key === 'sem-dia' ? 'none' : Number(key.slice(4)))
        }}
        testID="roteiro-folha-dias"
      />
      <DaySheet
        visible={adding !== null}
        title={adding === null ? '' : `Adicionar ao Dia ${adding + 1}`}
        options={unscheduled.map((place) => ({ key: place.id, label: place.name }))}
        onClose={() => setAdding(null)}
        onSelect={(key) => {
          const dayIndex = adding
          setAdding(null)
          if (dayIndex !== null) addToDay(dayIndex, key)
        }}
        testID="roteiro-folha-adicionar"
      />
    </ScrollView>
  )
}
