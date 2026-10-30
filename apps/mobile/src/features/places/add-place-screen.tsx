import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'

import { validatePlaceName } from '@trippy/domain'
import type { PlaceSearchCandidate } from '@trippy/domain'
import {
  Button,
  Notice,
  PlaceResult,
  Text,
  TextButton,
  TextField,
  useTheme,
} from '../../design-system'
import { useSync } from '../sync/sync-provider'
import { useNetworkOffline } from '../sync/use-network-gate'
import type { TripRole } from '../trips/trips-client'
import { getPlacesErrorMessage, usePlacesClient } from './places-client'
import { PlaceAttribution } from './place-attribution'

const SEARCH_DEBOUNCE_MS = 350
const MINIMUM_QUERY_LENGTH = 2

type AddPlaceScreenProps = {
  tripId: string
  tripName: string
  role: TripRole
}

export function AddPlaceScreen({ tripId }: AddPlaceScreenProps) {
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
  const [selectedRef, setSelectedRef] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [isSaving, setIsSaving] = useState(false)
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
      setSelectedRef(null)
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

  const selected = useMemo(
    () => candidates.find((candidate) => candidate.providerRef === selectedRef) ?? null,
    [candidates, selectedRef],
  )
  // Sem resultado utilizável (busca vazia, com erro ou offline): sugere só o nome digitado.
  const searchFailed =
    normalizedQuery.length >= MINIMUM_QUERY_LENGTH &&
    !isSearching &&
    candidates.length === 0 &&
    (hasSearched || isNetworkUnavailable || searchError !== null)

  const submit = useCallback(async () => {
    if (client === null) return
    const typedName = validatePlaceName(query)
    if (selected === null && !typedName.success) {
      setInputError(typedName.success ? null : typedName.message)
      return
    }

    setIsSaving(true)
    setInputError(null)
    try {
      const placeId =
        selected !== null
          ? await client.addPlaceFromCandidate(tripId, selected)
          : await client.addPlace(tripId, typedName.success ? typedName.value : '')
      const note = comment.trim()
      if (note) await client.setPlaceNote(tripId, placeId, note)
      router.back()
    } catch (error) {
      setInputError(getPlacesErrorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }, [client, comment, query, router, selected, tripId])

  const first = candidates[0]
  const canSubmit = client !== null && (selected !== null || (searchFailed && query.trim() !== ''))

  return (
    <SafeAreaView
      testID="add-place-screen"
      style={{ flex: 1, backgroundColor: theme.colors.ground }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            gap: 18,
            paddingHorizontal: theme.spacing.space5,
            paddingTop: theme.spacing.space2,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <TextButton label="Cancelar" onPress={() => router.back()} testID="add-place-cancel" />
          <Text variant="titleL" color={theme.colors.ink} accessibilityRole="header">
            Sugerir um lugar
          </Text>

          <TextField
            label="Nome, endereço ou link do Google Maps"
            value={query}
            onChangeText={changeQuery}
            maxLength={120}
            leadingIcon="search"
            autoCapitalize="words"
            autoFocus
            testID="place-search-query"
          />

          {showMinimumLength(normalizedQuery) ? (
            <Text variant="fieldHelp" color={theme.colors.inkMuted}>
              Digite pelo menos 2 caracteres para buscar.
            </Text>
          ) : null}
          {isSearching ? (
            <View accessibilityRole="progressbar" testID="place-search-loading">
              <ActivityIndicator color={theme.colors.forest} />
            </View>
          ) : null}
          {candidates.length > 0 ? (
            <View testID="place-search-candidates" style={{ gap: theme.spacing.space2 }}>
              {candidates.map((candidate, index) => (
                <PlaceResult
                  key={`${candidate.providerRef}-${index}`}
                  testID={`place-candidate-${index}`}
                  name={candidate.name}
                  localName={candidate.localName}
                  address={candidate.address}
                  localAddress={candidate.localAddress}
                  selected={candidate.providerRef === selectedRef}
                  disabled={isSaving}
                  onPress={() => setSelectedRef(candidate.providerRef)}
                />
              ))}
              {first ? (
                <PlaceAttribution
                  provider={first.provider}
                  datasource={first.datasource}
                  attribution={first.attribution}
                  testID="place-search-attribution"
                />
              ) : null}
            </View>
          ) : null}
          {isNetworkUnavailable ? (
            <Notice
              testID="place-search-offline"
              tone="offline"
              segments={[
                { strong: 'A busca precisa de internet.' },
                ' Você ainda pode sugerir o nome digitado e completar os dados depois.',
              ]}
            />
          ) : null}
          {searchError ? (
            <Notice testID="place-search-error" tone="change" segments={[searchError]} />
          ) : null}
          {searchFailed && !isNetworkUnavailable && searchError === null ? (
            <Notice
              testID="place-search-empty"
              tone="change"
              segments={[
                { strong: 'Não está aqui?' },
                ' Nenhum lugar encontrado. Você pode tentar de outro jeito ou sugerir o nome digitado.',
              ]}
            />
          ) : null}
          {hasSearched &&
          candidates.length === 0 &&
          attempt === 'primary' &&
          !isNetworkUnavailable ? (
            <Button
              label="Buscar de outro jeito"
              onPress={() => setAttempt('secondary')}
              variant="secondary"
              testID="place-search-secondary"
            />
          ) : null}

          <TextField
            label="Comentário"
            optional
            value={comment}
            onChangeText={setComment}
            placeholder="Por que vale a pena?"
            multiline
            minHeight={96}
            maxLength={500}
            testID="place-comment"
          />
          {inputError ? (
            <Notice testID="add-place-error" tone="change" segments={[inputError]} />
          ) : null}
        </ScrollView>
        <View
          style={{
            paddingBottom: theme.spacing.space4,
            paddingHorizontal: theme.spacing.space5,
            paddingTop: theme.spacing.space3,
          }}
        >
          <Button
            label="Sugerir ao grupo"
            onPress={() => void submit()}
            loading={isSaving}
            disabled={!canSubmit}
            testID="place-submit"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function showMinimumLength(query: string): boolean {
  return query.length === 1
}
