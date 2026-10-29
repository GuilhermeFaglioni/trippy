import { useCallback, useState } from 'react'
import { Platform, View } from 'react-native'

import { validatePlaceName } from '@trippy/domain'
import type { PlaceSearchCandidate } from '@trippy/domain'
import { Button, Card, Notice, TextField } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import { PlaceAttribution } from '../places/place-attribution'
import { getPlacesErrorMessage, usePlacesClient } from '../places/places-client'
import { useSync } from '../sync/sync-provider'
import { useNetworkOffline } from '../sync/use-network-gate'
import { type HereLocationResult, requestCurrentLocation } from './here-location'

const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))
const MAX_CANDIDATES = 5

type HereCardProps = {
  tripId: string
  dayIndex: number
  onRegistered?: () => void
  locate?: () => Promise<HereLocationResult>
}

type LocationPhase =
  'idle' | 'locating' | 'denied' | 'unavailable' | 'searching' | 'searched' | 'search-failed'

/** Registra "Estamos aqui": lugar fora do roteiro, por GPS ou nome digitado. */
export function HereCard({
  tripId,
  dayIndex,
  onRegistered,
  locate = requestCurrentLocation,
}: HereCardProps) {
  const theme = useTheme()
  const { client } = useSync()
  const placesClient = usePlacesClient()
  const isOffline = useNetworkOffline()
  const [isOpen, setIsOpen] = useState(false)
  const [phase, setPhase] = useState<LocationPhase>('idle')
  const [candidates, setCandidates] = useState<PlaceSearchCandidate[]>([])
  const [typedName, setTypedName] = useState('')
  const [nameMessage, setNameMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  // Lugar já criado cuja presença ainda não foi marcada: evita duplicar em nova tentativa.
  const [pendingPlaceId, setPendingPlaceId] = useState<string | null>(null)

  const reset = useCallback(() => {
    setIsOpen(false)
    setPhase('idle')
    setCandidates([])
    setTypedName('')
    setNameMessage(null)
    setError(null)
    setBusyKey(null)
    setPendingPlaceId(null)
  }, [])

  const finishRegistration = useCallback(
    async (placeId: string) => {
      if (client === null) return
      setPendingPlaceId(placeId)
      try {
        await client.markVisit(tripId, placeId)
      } catch (markError) {
        setError(
          `O lugar foi salvo, mas não conseguimos marcar sua presença. ${getPlacesErrorMessage(markError)}`,
        )
        return
      }
      reset()
      onRegistered?.()
    },
    [client, onRegistered, reset, tripId],
  )

  const handleLocate = useCallback(async () => {
    setPhase('locating')
    setError(null)
    let result: HereLocationResult
    try {
      result = await locate()
    } catch {
      result = { status: 'unavailable' }
    }

    if (result.status === 'denied') {
      setPhase('denied')
      return
    }
    if (result.status === 'unavailable') {
      setPhase('unavailable')
      return
    }
    if (isOffline) {
      setPhase('search-failed')
      return
    }

    setPhase('searching')
    try {
      const response = await placesClient.nearby(tripId, result.lat, result.lng)
      const found = response.candidates.slice(0, MAX_CANDIDATES)
      setCandidates(found)
      setPhase(found.length > 0 ? 'searched' : 'search-failed')
    } catch {
      setPhase('search-failed')
    }
  }, [isOffline, locate, placesClient, tripId])

  const registerCandidate = useCallback(
    async (candidate: PlaceSearchCandidate, index: number) => {
      if (client === null) return
      const key = `candidate-${index}`
      setBusyKey(key)
      setError(null)
      try {
        if (pendingPlaceId !== null) {
          await finishRegistration(pendingPlaceId)
          return
        }
        const placeId = await client.addPlaceFromCandidate(tripId, candidate, { dayIndex })
        await finishRegistration(placeId)
      } catch (registerError) {
        setError(getPlacesErrorMessage(registerError))
      } finally {
        setBusyKey(null)
      }
    },
    [client, dayIndex, finishRegistration, pendingPlaceId, tripId],
  )

  const registerTypedName = useCallback(async () => {
    if (client === null) return
    if (pendingPlaceId === null) {
      const validation = validatePlaceName(typedName)
      if (!validation.success) {
        setNameMessage(validation.message)
        return
      }
      setNameMessage(null)
      setBusyKey('name')
      setError(null)
      try {
        const placeId = await client.addPlace(tripId, validation.value, { dayIndex })
        await finishRegistration(placeId)
      } catch (registerError) {
        setError(getPlacesErrorMessage(registerError))
      } finally {
        setBusyKey(null)
      }
      return
    }

    setBusyKey('name')
    try {
      await finishRegistration(pendingPlaceId)
    } finally {
      setBusyKey(null)
    }
  }, [client, dayIndex, finishRegistration, pendingPlaceId, tripId, typedName])

  if (!isOpen) {
    return (
      <Card testID="hoje-estamos-aqui-card">
        <Button
          label="Estamos aqui"
          variant="secondary"
          onPress={() => setIsOpen(true)}
          testID="hoje-estamos-aqui"
        />
      </Card>
    )
  }

  const busy = busyKey !== null || phase === 'locating' || phase === 'searching'
  const showGpsButton = phase === 'idle' || phase === 'unavailable' || phase === 'locating'

  return (
    <Card testID="hoje-aqui-painel">
      <View style={{ gap: theme.spacing.space3 }}>
        <TypographyText family="display" style={[typography.titleS, { color: theme.colors.ink }]}>
          Estamos aqui
        </TypographyText>
        <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
          Usamos sua localização só agora, para sugerir lugares por perto. Se preferir, digite o
          nome.
        </TypographyText>

        {showGpsButton ? (
          <Button
            label="Usar minha localização"
            onPress={() => void handleLocate()}
            loading={phase === 'locating'}
            disabled={busy}
            testID="hoje-aqui-gps"
          />
        ) : null}

        {phase === 'locating' || phase === 'searching' ? (
          <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
            {phase === 'locating'
              ? 'Lendo sua localização...'
              : 'Buscando lugares perto de você...'}
          </TypographyText>
        ) : null}

        {phase === 'denied' ? (
          <Notice
            testID="hoje-aqui-sem-permissao"
            tone="warning"
            message="Sem acesso à localização. Digite o nome do lugar."
          />
        ) : null}

        {phase === 'unavailable' ? (
          <Notice
            testID="hoje-aqui-gps-indisponivel"
            tone="warning"
            message="Não conseguimos ler sua localização agora. Digite o nome do lugar."
          />
        ) : null}

        {phase === 'search-failed' ? (
          <Notice
            testID="hoje-aqui-busca-falhou"
            tone="warning"
            message="Não conseguimos buscar lugares perto de você. Digite o nome do lugar."
          />
        ) : null}

        {phase === 'searched' && candidates.length > 0 ? (
          <View testID="hoje-aqui-candidatos" style={{ gap: theme.spacing.space3 }}>
            {candidates.map((candidate, index) => (
              <View
                key={`${candidate.providerRef}-${index}`}
                style={{ gap: theme.spacing.space2 }}
                testID={`hoje-aqui-candidato-item-${index}`}
              >
                <TypographyText family="sans" style={{ color: theme.colors.ink }}>
                  {candidate.localName ?? candidate.name}
                </TypographyText>
                {candidate.address ? (
                  <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
                    {candidate.address}
                  </TypographyText>
                ) : null}
                <Button
                  label="Estamos aqui"
                  variant={index === 0 ? 'primary' : 'secondary'}
                  onPress={() => void registerCandidate(candidate, index)}
                  loading={busyKey === `candidate-${index}`}
                  disabled={busy || client === null}
                  testID={`hoje-aqui-candidato-${index}`}
                />
              </View>
            ))}
            <PlaceAttribution
              provider={candidates[0]?.provider ?? null}
              datasource={candidates[0]?.datasource ?? null}
              attribution={candidates[0]?.attribution ?? null}
              testID="hoje-aqui-atribuicao"
            />
          </View>
        ) : null}

        <View style={{ gap: theme.spacing.space2 }}>
          <TextField
            label="Nome do lugar"
            value={typedName}
            onChangeText={(value) => {
              setTypedName(value)
              setNameMessage(null)
            }}
            maxLength={120}
            autoCapitalize="words"
            testID="hoje-aqui-nome"
          />
          {nameMessage ? (
            <Notice testID="hoje-aqui-nome-invalido" tone="warning" message={nameMessage} />
          ) : null}
          <Button
            label="Salvar nome digitado"
            variant="secondary"
            onPress={() => void registerTypedName()}
            loading={busyKey === 'name'}
            disabled={busy || client === null}
            testID="hoje-aqui-salvar-nome"
          />
        </View>

        {error ? <Notice testID="hoje-aqui-erro" tone="danger" message={error} /> : null}

        <Button
          label="Cancelar"
          variant="secondary"
          onPress={reset}
          disabled={busyKey !== null}
          testID="hoje-aqui-cancelar"
        />
      </View>
    </Card>
  )
}
