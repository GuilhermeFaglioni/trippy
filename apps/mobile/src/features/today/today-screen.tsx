import { useCallback, useEffect, useState } from 'react'
import { Platform, ScrollView, View } from 'react-native'

import type { LivePlace } from '@trippy/sync'
import { Button, Card, Notice } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import { useSync } from '../sync/sync-provider'
import {
  computeTodayState,
  isDayDone,
  nextPlace,
  placesOfDay,
  recentChanges,
  staleness,
} from './today-model'

/** TestIDs Maestro: tela-hoje, hoje-banner-desatualizacao, hoje-dia, hoje-proximo-lugar, hoje-lugar-<slug>, hoje-eu-fui-<slug>, hoje-o-que-mudou. */
const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

type TodayScreenProps = {
  tripId: string
  tripName: string
  timezone: string
  startDate: string
  endDate: string
  onOpenPhotos?: () => void
  onShowAddress?: (placeId: string) => void
}

function testSlug(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
  return slug || 'sem-nome'
}

function displayName(place: LivePlace): string {
  return place.localName ?? place.name
}

export function TodayScreen({
  tripId,
  tripName,
  timezone,
  startDate,
  endDate,
  onOpenPhotos,
  onShowAddress,
}: TodayScreenProps) {
  const theme = useTheme()
  const { client, status } = useSync()
  const [places, setPlaces] = useState<LivePlace[]>([])
  const [busyPlaceId, setBusyPlaceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadPlaces = useCallback(async () => {
    if (client === null || !tripId) {
      setPlaces([])
      return
    }
    setError(null)
    try {
      setPlaces(await client.listPlaces(tripId))
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Não foi possível carregar os lugares de hoje neste aparelho.',
      )
    }
  }, [client, tripId])

  useEffect(() => {
    void loadPlaces()
    if (client === null) return
    return client.subscribe(() => void loadPlaces())
  }, [client, loadPlaces])

  const toggleVisit = useCallback(
    async (place: LivePlace) => {
      if (client === null) return
      setBusyPlaceId(place.id)
      setError(null)
      try {
        if (place.visitedByMe) await client.unmarkVisit(tripId, place.id)
        else await client.markVisit(tripId, place.id)
        await loadPlaces()
      } catch (writeError) {
        setError(
          writeError instanceof Error
            ? writeError.message
            : 'Não foi possível salvar sua presença neste lugar.',
        )
      } finally {
        setBusyPlaceId(null)
      }
    },
    [client, loadPlaces, tripId],
  )

  const toggleFavorite = useCallback(
    async (place: LivePlace) => {
      if (client === null) return
      setBusyPlaceId(place.id)
      setError(null)
      try {
        await client.setFavorite(tripId, place.id, !place.favoriteByMe)
        await loadPlaces()
      } catch (writeError) {
        setError(
          writeError instanceof Error ? writeError.message : 'Não foi possível salvar o favorito.',
        )
      } finally {
        setBusyPlaceId(null)
      }
    },
    [client, loadPlaces, tripId],
  )

  const now = new Date()
  const todayState = computeTodayState(startDate, endDate, timezone, now)
  const dayPlaces = todayState.kind === 'during' ? placesOfDay(places, todayState.dayIndex) : []
  const next = nextPlace(dayPlaces)
  const stale = staleness(status.lastSyncedAt, status.notSent, timezone)
  const needsAttention = status.lastSyncedAt === null || status.notSent > 0
  const changes = recentChanges(places, now)

  let dayLabel: string
  if (todayState.kind === 'during') {
    dayLabel = `Dia ${todayState.dayNumber} de ${todayState.totalDays}`
  } else if (todayState.kind === 'before') {
    const { daysUntil } = todayState
    dayLabel = `A viagem começa em ${daysUntil} ${daysUntil === 1 ? 'dia' : 'dias'}`
  } else {
    dayLabel = 'A viagem terminou'
  }

  let nextLabel: string
  if (todayState.kind !== 'during') {
    nextLabel = ''
  } else if (dayPlaces.length === 0) {
    nextLabel = 'Nenhum lugar no roteiro de hoje'
  } else if (isDayDone(dayPlaces)) {
    nextLabel = 'Todos os lugares de hoje foram visitados'
  } else {
    nextLabel = next ? displayName(next) : ''
  }

  return (
    <ScrollView
      testID="tela-hoje"
      contentContainerStyle={{ gap: theme.spacing.space4, padding: theme.spacing.space5 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: theme.spacing.space2 }}>
        <TypographyText family="display" style={[typography.titleL, { color: theme.colors.ink }]}>
          Hoje
        </TypographyText>
        <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
          {tripName}
        </TypographyText>
      </View>

      <Notice
        testID="hoje-banner-desatualizacao"
        tone={needsAttention ? 'warning' : 'neutral'}
        message={[`${stale.lastUpdateLabel}.`, stale.notSentLabel ? `${stale.notSentLabel}.` : null]
          .filter(Boolean)
          .join(' ')}
      />

      {error ? <Notice testID="hoje-erro" tone="danger" message={error} /> : null}

      <Card testID="hoje-dia">
        <TypographyText family="display" style={[typography.titleM, { color: theme.colors.ink }]}>
          {dayLabel}
        </TypographyText>
      </Card>

      {todayState.kind === 'during' ? (
        <Card>
          <View style={{ gap: theme.spacing.space2 }}>
            <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
              Próximo lugar
            </TypographyText>
            <TypographyText
              family="display"
              testID="hoje-proximo-lugar"
              style={[typography.titleS, { color: theme.colors.ink }]}
            >
              {nextLabel}
            </TypographyText>
          </View>
        </Card>
      ) : null}

      {todayState.kind === 'during'
        ? dayPlaces.map((place) => {
            const slug = testSlug(displayName(place))
            const busy = busyPlaceId === place.id
            return (
              <Card key={place.id} testID={`hoje-lugar-${slug}`}>
                <View style={{ gap: theme.spacing.space3 }}>
                  <TypographyText family="sans" style={{ color: theme.colors.ink }}>
                    {displayName(place)}
                  </TypographyText>
                  <View
                    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.space2 }}
                  >
                    <Button
                      label={place.visitedByMe ? 'Eu fui ✓' : 'Eu fui'}
                      variant="secondary"
                      selected={place.visitedByMe}
                      loading={busy}
                      onPress={() => void toggleVisit(place)}
                      testID={`hoje-eu-fui-${slug}`}
                    />
                    <Button
                      label={place.favoriteByMe ? 'Favorito ✓' : 'Favorito'}
                      variant="secondary"
                      selected={place.favoriteByMe}
                      loading={busy}
                      onPress={() => void toggleFavorite(place)}
                      testID={`hoje-favorito-${slug}`}
                    />
                    <Button
                      label="Foto"
                      variant="secondary"
                      onPress={() => onOpenPhotos?.()}
                      testID={`hoje-foto-${slug}`}
                    />
                    {onShowAddress ? (
                      <Button
                        label="Mostrar endereço"
                        variant="secondary"
                        onPress={() => onShowAddress(place.id)}
                        testID={`hoje-mostrar-endereco-${slug}`}
                      />
                    ) : null}
                  </View>
                </View>
              </Card>
            )
          })
        : null}

      <Card testID="hoje-o-que-mudou">
        <View style={{ gap: theme.spacing.space2 }}>
          <TypographyText family="display" style={[typography.titleS, { color: theme.colors.ink }]}>
            O que mudou
          </TypographyText>
          {changes.length === 0 ? (
            <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
              Nenhuma alteração recebida
            </TypographyText>
          ) : (
            changes.map((place) => (
              <TypographyText key={place.id} family="sans" style={{ color: theme.colors.ink }}>
                {`Novo lugar: ${displayName(place)}`}
              </TypographyText>
            ))
          )}
        </View>
      </Card>
    </ScrollView>
  )
}
