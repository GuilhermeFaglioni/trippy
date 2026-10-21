import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'

import { validatePlaceName } from '@trippy/domain'
import type { PlaceSearchCandidate } from '@trippy/domain'
import { Button, Card, Notice, TextField } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import { useSync } from '../sync/sync-provider'
import { useNetworkOffline } from '../sync/use-network-gate'
import type { TripRole } from '../trips/trips-client'
import { getPlacesErrorMessage, usePlacesClient } from './places-client'
import { PlaceAttribution } from './place-attribution'

const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))
const SEARCH_DEBOUNCE_MS = 350
const MINIMUM_QUERY_LENGTH = 2

type AddPlaceScreenProps = {
  tripId: string
  tripName: string
  role: TripRole
}

export function AddPlaceScreen({ tripId, tripName }: AddPlaceScreenProps) {
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSync()
  const placesClient = usePlacesClient()
  const isOffline = useNetworkOffline()
  const requestGeneration = useRef(0)
  const previousSearchKey = useRef('')
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState<'primary' | 'secondary'>('primary')
  const [candidates, setCandidates] = useState<PlaceSearchCandidate[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [isNetworkUnavailable, setIsNetworkUnavailable] = useState(false)
  const [savingCandidate, setSavingCandidate] = useState<string | null>(null)
  const [isSavingName, setIsSavingName] = useState(false)
  const [inputError, setInputError] = useState<string | null>(null)

  const normalizedQuery = useMemo(() => query.trim(), [query])
  const searchKey = `${attempt}\u0000${normalizedQuery}`

  useEffect(() => {
    const searchKeyChanged = previousSearchKey.current !== searchKey
    previousSearchKey.current = searchKey
    const generation = ++requestGeneration.current
    setIsSearching(false)
    if (searchKeyChanged) {
      setCandidates([])
      setSearchError(null)
      setHasSearched(false)
    }

    if (normalizedQuery.length < MINIMUM_QUERY_LENGTH) {
      setIsNetworkUnavailable(false)
      return
    }

    if (isOffline) {
      setIsNetworkUnavailable(true)
      return
    }

    setIsNetworkUnavailable(false)
    const timeout = setTimeout(() => {
      setIsSearching(true)
      void placesClient
        .search(tripId, normalizedQuery, attempt)
        .then((response) => {
          if (requestGeneration.current !== generation) return
          setCandidates(response.candidates)
          setHasSearched(true)
        })
        .catch((error: unknown) => {
          if (requestGeneration.current !== generation) return
          if (error instanceof TypeError) setIsNetworkUnavailable(true)
          else setSearchError(getPlacesErrorMessage(error))
          setHasSearched(false)
        })
        .finally(() => {
          if (requestGeneration.current === generation) setIsSearching(false)
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timeout)
      if (requestGeneration.current === generation) requestGeneration.current += 1
    }
  }, [attempt, isOffline, normalizedQuery, placesClient, searchKey, tripId])

  const changeQuery = useCallback((value: string) => {
    setQuery(value)
    setAttempt('primary')
    setInputError(null)
  }, [])

  const saveCandidate = useCallback(
    async (candidate: PlaceSearchCandidate) => {
      if (client === null) return
      setSavingCandidate(candidate.providerRef)
      setInputError(null)
      try {
        await client.addPlaceFromCandidate(tripId, candidate)
        router.back()
      } catch (error) {
        setInputError(getPlacesErrorMessage(error))
      } finally {
        setSavingCandidate(null)
      }
    },
    [client, router, tripId],
  )

  const saveTypedName = useCallback(async () => {
    const validation = validatePlaceName(query)
    if (!validation.success) {
      setInputError(validation.message)
      return
    }
    if (client === null) return

    setIsSavingName(true)
    setInputError(null)
    try {
      await client.addPlace(tripId, validation.value)
      router.back()
    } catch (error) {
      setInputError(getPlacesErrorMessage(error))
    } finally {
      setIsSavingName(false)
    }
  }, [client, query, router, tripId])

  const showMinimumLength = normalizedQuery.length === 1

  return (
    <SafeAreaView
      testID="add-place-screen"
      style={{ flex: 1, backgroundColor: theme.colors.ground }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: theme.spacing.space4,
          padding: theme.spacing.space5,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: theme.spacing.space2 }}>
          <TypographyText family="display" style={[typography.titleL, { color: theme.colors.ink }]}>
            Adicionar lugar
          </TypographyText>
          <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
            {`${tripName || 'Viagem'} · busque pelo nome ou endereço.`}
          </TypographyText>
        </View>

        <Card testID="place-search-card">
          <View style={{ gap: theme.spacing.space3 }}>
            <TextField
              label="Buscar lugar"
              value={query}
              onChangeText={changeQuery}
              maxLength={120}
              autoCapitalize="words"
              testID="place-search-query"
            />
            {showMinimumLength ? (
              <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
                Digite pelo menos 2 caracteres para buscar.
              </TypographyText>
            ) : null}
            {isSearching ? (
              <View accessibilityRole="progressbar" testID="place-search-loading">
                <ActivityIndicator color={theme.colors.forest} />
              </View>
            ) : null}
            {isNetworkUnavailable ? (
              <Notice
                testID="place-search-offline"
                tone="warning"
                title="A busca precisa de internet."
                message="Você ainda pode salvar o nome digitado e completar os dados depois."
              />
            ) : null}
            {searchError ? (
              <Notice testID="place-search-error" tone="warning" message={searchError} />
            ) : null}
            {hasSearched && candidates.length === 0 ? (
              <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
                Nenhum lugar encontrado. Você pode tentar de outro jeito ou salvar o nome digitado.
              </TypographyText>
            ) : null}
            {hasSearched && !isNetworkUnavailable && attempt === 'primary' ? (
              <Button
                label="Não está aqui? Buscar de outro jeito"
                onPress={() => setAttempt('secondary')}
                variant="secondary"
                testID="place-search-secondary"
              />
            ) : null}
          </View>
        </Card>

        {candidates.length > 0 ? (
          <View testID="place-search-candidates" style={{ gap: theme.spacing.space3 }}>
            {candidates.map((candidate, index) => (
              <Card key={`${candidate.providerRef}-${index}`} testID={`place-candidate-${index}`}>
                <View style={{ gap: theme.spacing.space3 }}>
                  <View style={{ gap: theme.spacing.space1 }}>
                    <TypographyText family="sans" style={[typography.titleS, { color: theme.colors.ink }]}>
                      {candidate.name}
                    </TypographyText>
                    {candidate.localName && candidate.localName !== candidate.name ? (
                      <TypographyText
                        family="local"
                        style={[typography.titleS, { color: theme.colors.inkMuted }]}
                        testID={`candidate-local-name-${index}`}
                      >
                        {candidate.localName}
                      </TypographyText>
                    ) : null}
                    {candidate.address ? (
                      <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
                        {candidate.address}
                      </TypographyText>
                    ) : null}
                    {candidate.localAddress && candidate.localAddress !== candidate.address ? (
                      <TypographyText
                        family="local"
                        style={{ color: theme.colors.inkMuted }}
                        testID={`candidate-local-address-${index}`}
                      >
                        {candidate.localAddress}
                      </TypographyText>
                    ) : null}
                  </View>
                  <PlaceAttribution
                    provider={candidate.provider}
                    datasource={candidate.datasource}
                    attribution={candidate.attribution}
                    testID={`candidate-attribution-${index}`}
                  />
                  <Button
                    label="Salvar este lugar"
                    onPress={() => void saveCandidate(candidate)}
                    loading={savingCandidate === candidate.providerRef}
                    disabled={client === null || savingCandidate !== null}
                    variant={index === 0 ? 'primary' : 'secondary'}
                    testID={`save-candidate-${index}`}
                  />
                </View>
              </Card>
            ))}
          </View>
        ) : null}

        <Card testID="manual-place-card">
          <View style={{ gap: theme.spacing.space3 }}>
            <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
              {isNetworkUnavailable
                ? 'Sem internet? Salve o nome agora e complete os dados depois.'
                : 'Também dá para salvar só o nome e completar os dados depois.'}
            </TypographyText>
            {inputError ? (
              <Notice testID="add-place-error" tone="danger" message={inputError} />
            ) : null}
            <Button
              label="Salvar nome digitado"
              onPress={() => void saveTypedName()}
              loading={isSavingName}
              disabled={client === null || !query.trim()}
              variant={candidates.length === 0 ? 'primary' : 'secondary'}
              testID="save-typed-place"
            />
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  )
}
