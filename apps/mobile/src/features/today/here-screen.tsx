import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { validatePlaceName } from '@trippy/domain'
import type { PlaceSearchCandidate } from '@trippy/domain'
import { PlaceAttribution } from '../places/place-attribution'
import { getPlacesErrorMessage, usePlacesClient } from '../places/places-client'
import { useSync } from '../sync/sync-provider'
import { useNetworkOffline } from '../sync/use-network-gate'
import { type HereLocationResult, requestCurrentLocation } from './here-location'
import { HereView, type HereCandidateView, type HerePhase } from './here-view'

const MAX_CANDIDATES = 5
const EARTH_RADIUS_M = 6_371_000

type HereScreenProps = {
  tripId: string
  dayIndex: number
  onClose: () => void
  locate?: () => Promise<HereLocationResult>
}

type Origin = { lat: number; lng: number }

function distanceMeters(from: Origin, to: Origin): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180
  const a =
    Math.sin(rad(to.lat - from.lat) / 2) ** 2 +
    Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(rad(to.lng - from.lng) / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
}

function distanceLabel(meters: number, first: boolean): string {
  const rounded =
    meters < 1000
      ? `${Math.max(10, Math.round(meters / 10) * 10)} m`
      : `${(meters / 1000).toFixed(1).replace('.', ',')} km`
  return `a ${rounded}${first ? ' · pelo GPS do celular' : ''}`
}

function candidateKey(candidate: PlaceSearchCandidate, index: number): string {
  return `${candidate.providerRef}-${index}`
}

/** "Estamos aqui": registra um lugar fora do roteiro, por GPS ou nome digitado, e marca "Eu fui". */
export function HereScreen({
  tripId,
  dayIndex,
  onClose,
  locate = requestCurrentLocation,
}: HereScreenProps) {
  const { client } = useSync()
  const placesClient = usePlacesClient()
  const isOffline = useNetworkOffline()
  const [phase, setPhase] = useState<HerePhase>('searching')
  const [origin, setOrigin] = useState<Origin | null>(null)
  const [candidates, setCandidates] = useState<PlaceSearchCandidate[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [typedName, setTypedName] = useState('')
  const [nameMessage, setNameMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Lugar já criado cuja presença ainda não foi marcada: evita duplicar em nova tentativa.
  const pendingPlaceId = useRef<string | null>(null)
  const generation = useRef(0)

  const handleLocate = useCallback(async () => {
    const current = ++generation.current
    setPhase('searching')
    setError(null)
    let result: HereLocationResult
    try {
      result = await locate()
    } catch {
      result = { status: 'unavailable' }
    }
    if (current !== generation.current) return

    if (result.status !== 'granted') {
      setPhase('no-gps')
      return
    }
    setOrigin({ lat: result.lat, lng: result.lng })
    if (isOffline) {
      setPhase('no-results')
      return
    }
    try {
      const response = await placesClient.nearby(tripId, result.lat, result.lng)
      if (current !== generation.current) return
      const found = response.candidates.slice(0, MAX_CANDIDATES)
      setCandidates(found)
      setSelectedKey(found.length > 0 ? candidateKey(found[0]!, 0) : null)
      setPhase(found.length > 0 ? 'candidates' : 'no-results')
    } catch {
      if (current === generation.current) setPhase('no-results')
    }
  }, [isOffline, locate, placesClient, tripId])

  useEffect(() => {
    void handleLocate()
    return () => {
      generation.current += 1
    }
    // A leitura do GPS acontece uma vez, ao abrir a tela que o usuário pediu.
  }, [])

  const views = useMemo<HereCandidateView[]>(
    () =>
      candidates.map((candidate, index) => ({
        key: candidateKey(candidate, index),
        name: candidate.name,
        localName: candidate.localName,
        detail:
          origin === null
            ? (candidate.address ?? '')
            : distanceLabel(distanceMeters(origin, candidate), index === 0),
      })),
    [candidates, origin],
  )

  const typed = typedName.trim() !== ''
  const selected = candidates.find(
    (candidate, index) => candidateKey(candidate, index) === selectedKey,
  )
  const canSubmit = client !== null && !busy && (typed || selected !== undefined)

  const finish = useCallback(
    async (placeId: string) => {
      if (client === null) return
      pendingPlaceId.current = placeId
      try {
        await client.markVisit(tripId, placeId)
      } catch (markError) {
        setError(
          `O lugar foi salvo, mas não conseguimos marcar sua presença. ${getPlacesErrorMessage(markError)}`,
        )
        return
      }
      pendingPlaceId.current = null
      onClose()
    },
    [client, onClose, tripId],
  )

  const submit = useCallback(async () => {
    if (client === null) return
    setError(null)
    setNameMessage(null)
    setBusy(true)
    try {
      if (pendingPlaceId.current !== null) {
        await finish(pendingPlaceId.current)
        return
      }
      if (typed) {
        const validation = validatePlaceName(typedName)
        if (!validation.success) {
          setNameMessage(validation.message)
          return
        }
        await finish(await client.addPlace(tripId, validation.value, { dayIndex }))
      } else if (selected !== undefined) {
        await finish(await client.addPlaceFromCandidate(tripId, selected, { dayIndex }))
      }
    } catch (registerError) {
      setError(getPlacesErrorMessage(registerError))
    } finally {
      setBusy(false)
    }
  }, [client, dayIndex, finish, selected, tripId, typed, typedName])

  const first = candidates[0]

  return (
    <HereView
      phase={phase}
      candidates={views}
      selectedKey={typed ? null : selectedKey}
      name={typedName}
      nameError={nameMessage}
      error={error}
      busy={busy}
      canSubmit={canSubmit}
      footer={
        phase === 'candidates' ? (
          <PlaceAttribution
            provider={first?.provider ?? null}
            datasource={first?.datasource ?? null}
            attribution={first?.attribution ?? null}
            testID="hoje-aqui-atribuicao"
          />
        ) : null
      }
      onCancel={onClose}
      onSelect={(key) => {
        setSelectedKey(key)
        setTypedName('')
        setNameMessage(null)
      }}
      onChangeName={(value) => {
        setTypedName(value)
        setNameMessage(null)
      }}
      onRetryLocation={() => void handleLocate()}
      onSubmit={() => void submit()}
    />
  )
}
