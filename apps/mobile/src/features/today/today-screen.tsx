import { useCallback, useEffect, useState } from 'react'

import type { LivePlace } from '@trippy/sync'
import type { NoticeSegment } from '../../design-system'
import { addressCardState } from '../places/address-card-model'
import { useSync } from '../sync/sync-provider'
import { useNetworkOffline } from '../sync/use-network-gate'
import {
  computeTodayState,
  isDayDone,
  nextPlace,
  placesOfDay,
  recentChanges,
  staleness,
} from './today-model'
import { TodayView, type TodayNextPlace } from './today-view'

/** TestIDs Maestro: tela-hoje, hoje-banner-desatualizacao, hoje-dia, hoje-proximo-lugar, hoje-estamos-aqui (botão que abre a tela Estamos aqui, só durante a viagem), hoje-lugar-<slug> (e -eu-fui, -favorito, -foto), hoje-o-que-mudou. */

type TodayScreenProps = {
  tripId: string
  timezone: string
  startDate: string
  endDate: string
  onOpenPhotos?: () => void
  onShowAddress?: (placeId: string) => void
  onHere: (dayIndex: number) => void
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
  timezone,
  startDate,
  endDate,
  onOpenPhotos,
  onShowAddress,
  onHere,
}: TodayScreenProps) {
  const isOffline = useNetworkOffline()
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
  const allVisited = isDayDone(dayPlaces)

  let title: string
  if (todayState.kind === 'during') {
    title = `Dia ${todayState.dayNumber} de ${todayState.totalDays}`
  } else if (todayState.kind === 'before') {
    const { daysUntil } = todayState
    title = `A viagem começa em ${daysUntil} ${daysUntil === 1 ? 'dia' : 'dias'}`
  } else {
    title = 'A viagem terminou'
  }

  let offlineNotice: NoticeSegment[] | null = null
  if (isOffline || needsAttention) {
    const updated = stale.lastUpdateLabel.replace(/^Roteiro /u, '')
    offlineNotice = [`${isOffline ? 'Sem internet · ' : ''}${updated}`]
    if (status.notSent > 0) {
      offlineNotice.push(
        ' · ',
        { strong: `${status.notSent} ${status.notSent === 1 ? 'registro' : 'registros'}` },
        ' esperando envio',
      )
    }
  }

  let tomorrow: string | null = null
  if (todayState.kind === 'during' && todayState.dayNumber < todayState.totalDays) {
    const first = placesOfDay(places, todayState.dayIndex + 1)[0]
    if (first) {
      tomorrow = `Amanhã: Dia ${todayState.dayNumber + 1}, começando por ${displayName(first)}.`
    }
  }

  return (
    <TodayView
      offlineNotice={offlineNotice}
      error={error}
      title={title}
      phase={todayState.kind === 'during' ? 'during' : todayState.kind}
      rows={dayPlaces.map((place, index) => ({
        id: place.id,
        slug: testSlug(displayName(place)),
        number: index + 1,
        name: displayName(place),
        visited: place.visitedByMe,
        favorite: place.favoriteByMe,
      }))}
      next={next ? nextView(next) : null}
      allVisited={allVisited}
      tomorrow={tomorrow}
      changes={changes.map((place) => [
        { strong: 'O que mudou:' },
        ` Novo lugar: ${displayName(place)}.`,
      ])}
      busyPlaceId={busyPlaceId}
      onToggleVisit={(placeId) => {
        const place = places.find((candidate) => candidate.id === placeId)
        if (place) void toggleVisit(place)
      }}
      onToggleFavorite={(placeId) => {
        const place = places.find((candidate) => candidate.id === placeId)
        if (place) void toggleFavorite(place)
      }}
      onPhoto={() => onOpenPhotos?.()}
      onShowAddress={onShowAddress}
      onHere={() => onHere(todayState.kind === 'during' ? todayState.dayIndex : 0)}
    />
  )
}

function nextView(place: LivePlace): TodayNextPlace {
  const card = addressCardState(place)
  const name = displayName(place)
  const localName = card.kind === 'empty' ? card.name : card.name
  const parts = [
    localName !== place.name ? localName : null,
    card.kind === 'empty' ? null : card.address,
  ].filter((part): part is string => part !== null && part !== '')
  return { id: place.id, name, localLine: parts.length > 0 ? parts.join(' · ') : null }
}
