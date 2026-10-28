import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native'

import { canEditItinerary } from '@trippy/domain'
import type { ItineraryDay, ItineraryDraft, LivePlace } from '@trippy/sync'
import { Button, Card, Notice, TextField } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import { useSession } from '../auth/session-provider'
import { useSync } from '../sync/sync-provider'

/** TestIDs Maestro: roteiro-dia-<índice>, roteiro-lugar-<slug>-<ação>, conflito-roteiro. */
const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

type TripDay = { dayIndex: number; date: string; label: string }

type ItineraryScreenProps = {
  tripId: string
  startDate: string
  endDate: string
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

function createTripDays(startDate: string, endDate: string): TripDay[] {
  const start = parseIsoDate(startDate)
  const end = parseIsoDate(endDate)
  if (start === null || end === null || end < start) return []

  const days: TripDay[] = []
  const current = new Date(start)
  while (current <= end && days.length <= 365) {
    const date = current.toISOString().slice(0, 10)
    days.push({ dayIndex: days.length, date, label: formatDate(date) })
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

export function ItineraryScreen({ tripId, startDate, endDate }: ItineraryScreenProps) {
  const theme = useTheme()
  const { session } = useSession()
  const { client } = useSync()
  const days = useMemo(() => createTripDays(startDate, endDate), [endDate, startDate])
  const [places, setPlaces] = useState<LivePlace[]>([])
  const [members, setMembers] = useState<
    Awaited<ReturnType<NonNullable<typeof client>['listMembers']>>
  >([])
  const [drafts, setDrafts] = useState<ItineraryDraft[]>([])
  const [dayInputs, setDayInputs] = useState<Record<string, string>>({})
  const [moveDayInputs, setMoveDayInputs] = useState<Record<string, string>>({})
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
        setBusy(false)
      }
    },
    [canEdit, client, loadData, tripId],
  )

  const moveInDay = useCallback(
    (dayIndex: number, placeIndex: number, direction: -1 | 1) => {
      const dayPlaces = placesForDay(places, dayIndex, days.length)
      const targetIndex = placeIndex + direction
      if (targetIndex < 0 || targetIndex >= dayPlaces.length) return
      const next = [...dayPlaces]
      ;[next[placeIndex], next[targetIndex]] = [next[targetIndex]!, next[placeIndex]!]
      void arrange([{ dayIndex, placeIds: next.map((place) => place.id) }])
    },
    [arrange, days.length, places],
  )

  const addToDay = useCallback(
    (place: LivePlace) => {
      const value = dayInputs[place.id] ?? '1'
      const dayIndex = Number(value) - 1
      if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= days.length) {
        setError(`Informe um dia entre 1 e ${days.length}.`)
        return
      }
      const targetPlaces = placesForDay(places, dayIndex, days.length)
      void arrange([
        { dayIndex, placeIds: [...targetPlaces.map((candidate) => candidate.id), place.id] },
      ])
    },
    [arrange, dayInputs, days.length, places],
  )

  const removeFromDay = useCallback(
    (place: LivePlace) => {
      const dayIndex = placeDayIndex(place, days.length)
      if (dayIndex === null) return
      const dayPlaces = placesForDay(places, dayIndex, days.length)
      void arrange([
        {
          dayIndex,
          placeIds: dayPlaces
            .filter((candidate) => candidate.id !== place.id)
            .map((candidate) => candidate.id),
        },
      ])
    },
    [arrange, days.length, places],
  )

  const moveToDay = useCallback(
    (place: LivePlace) => {
      const sourceDay = placeDayIndex(place, days.length)
      const targetDay = Number(moveDayInputs[place.id] ?? (sourceDay === 0 ? '2' : '1')) - 1
      if (
        sourceDay === null ||
        !Number.isInteger(targetDay) ||
        targetDay < 0 ||
        targetDay >= days.length
      ) {
        setError(`Informe um dia entre 1 e ${days.length}.`)
        return
      }
      if (targetDay === sourceDay) {
        setError('Escolha um dia diferente do atual.')
        return
      }
      const sourcePlaces = placesForDay(places, sourceDay, days.length)
      const targetPlaces = placesForDay(places, targetDay, days.length)
      void arrange([
        {
          dayIndex: sourceDay,
          placeIds: sourcePlaces
            .filter((candidate) => candidate.id !== place.id)
            .map((candidate) => candidate.id),
        },
        {
          dayIndex: targetDay,
          placeIds: [...targetPlaces.map((candidate) => candidate.id), place.id],
        },
      ])
    },
    [arrange, days.length, moveDayInputs, places],
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

  return (
    <ScrollView
      testID="tela-roteiro"
      contentContainerStyle={{ gap: theme.spacing.space4, padding: theme.spacing.space5 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: theme.spacing.space2 }}>
        <TypographyText family="display" style={[typography.titleL, { color: theme.colors.ink }]}>
          Roteiro
        </TypographyText>
        <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
          Dias e lugares na ordem planejada.
        </TypographyText>
      </View>

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

      {days.map((day) => {
        const dayPlaces = placesForDay(places, day.dayIndex, days.length)
        return (
          <Card key={day.dayIndex} testID={`roteiro-dia-${day.dayIndex}`}>
            <View style={{ gap: theme.spacing.space3 }}>
              <TypographyText
                family="display"
                style={[typography.titleM, { color: theme.colors.ink }]}
              >
                {`Dia ${day.dayIndex + 1} · ${day.label}`}
              </TypographyText>
              {dayPlaces.length === 0 ? (
                <Notice message="Dia livre. Quer adicionar algum lugar?" />
              ) : (
                dayPlaces.map((place, index) => {
                  const slug = testSlug(place.name)
                  return (
                    <View
                      key={place.id}
                      testID={`roteiro-lugar-${slug}`}
                      style={{
                        gap: theme.spacing.space2,
                        borderTopColor: theme.colors.line,
                        borderTopWidth: index === 0 ? 0 : 1,
                        paddingTop: index === 0 ? 0 : theme.spacing.space3,
                      }}
                    >
                      <TypographyText
                        family="sans"
                        style={[typography.bodyStrong, { color: theme.colors.ink }]}
                      >
                        {`${index + 1}. ${place.name}`}
                      </TypographyText>
                      {canEdit ? (
                        <View style={{ gap: theme.spacing.space2 }}>
                          <View
                            style={{
                              flexDirection: 'row',
                              flexWrap: 'wrap',
                              gap: theme.spacing.space2,
                            }}
                          >
                            <Button
                              label="Subir"
                              variant="secondary"
                              disabled={busy || index === 0}
                              onPress={() => moveInDay(day.dayIndex, index, -1)}
                              testID={`roteiro-lugar-${slug}-subir`}
                            />
                            <Button
                              label="Descer"
                              variant="secondary"
                              disabled={busy || index === dayPlaces.length - 1}
                              onPress={() => moveInDay(day.dayIndex, index, 1)}
                              testID={`roteiro-lugar-${slug}-descer`}
                            />
                            <Button
                              label="Tirar do dia"
                              variant="secondary"
                              disabled={busy}
                              onPress={() => removeFromDay(place)}
                              testID={`roteiro-lugar-${slug}-tirar-do-dia`}
                            />
                          </View>
                          {days.length > 1 ? (
                            <View style={{ gap: theme.spacing.space2 }}>
                              <TextField
                                label={`Mover ${place.name} para o dia`}
                                value={
                                  moveDayInputs[place.id] ?? String(day.dayIndex === 0 ? 2 : 1)
                                }
                                onChangeText={(value) =>
                                  setMoveDayInputs((current) => ({ ...current, [place.id]: value }))
                                }
                                keyboardType="number-pad"
                                accessibilityHint={`Escolha um dia entre 1 e ${days.length}, diferente do atual.`}
                                testID={`roteiro-lugar-${slug}-dia-destino`}
                              />
                              <Button
                                label={`Mover para o dia ${moveDayInputs[place.id] ?? (day.dayIndex === 0 ? '2' : '1')}`}
                                variant="secondary"
                                disabled={busy}
                                onPress={() => moveToDay(place)}
                                testID={`roteiro-lugar-${slug}-mover-dia`}
                              />
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  )
                })
              )}
            </View>
          </Card>
        )
      })}

      <View style={{ gap: theme.spacing.space3 }}>
        <TypographyText family="display" style={[typography.titleM, { color: theme.colors.ink }]}>
          Lugares sem dia
        </TypographyText>
        {unscheduled.length === 0 ? (
          <Notice
            testID="roteiro-sem-lugares-sem-dia"
            message="Todos os lugares já estão em um dia do roteiro."
          />
        ) : (
          unscheduled.map((place) => {
            const slug = testSlug(place.name)
            const selectedDay = dayInputs[place.id] ?? '1'
            return (
              <Card key={place.id} testID={`roteiro-sem-dia-${slug}`}>
                <View style={{ gap: theme.spacing.space3 }}>
                  <TypographyText
                    family="sans"
                    style={[typography.bodyStrong, { color: theme.colors.ink }]}
                  >
                    {place.name}
                  </TypographyText>
                  {canEdit ? (
                    <>
                      <TextField
                        label={`Dia de destino para ${place.name}`}
                        value={selectedDay}
                        onChangeText={(value) =>
                          setDayInputs((current) => ({ ...current, [place.id]: value }))
                        }
                        keyboardType="number-pad"
                        accessibilityHint={`Escolha um número entre 1 e ${days.length}.`}
                        testID={`roteiro-lugar-${slug}-dia`}
                      />
                      <Button
                        label={`Pôr no dia ${selectedDay || 'N'}`}
                        disabled={busy || days.length === 0}
                        onPress={() => addToDay(place)}
                        testID={`roteiro-lugar-${slug}-por-no-dia`}
                      />
                    </>
                  ) : null}
                </View>
              </Card>
            )
          })
        )}
      </View>

      {!canEdit && !isLoading ? (
        <Notice
          testID="roteiro-somente-leitura"
          message="Você pode consultar o roteiro. Só organizador e coorganizadores podem alterá-lo."
        />
      ) : null}
    </ScrollView>
  )
}
