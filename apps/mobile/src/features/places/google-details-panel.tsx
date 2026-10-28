import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, Platform, View } from 'react-native'
import { Image } from 'expo-image'

import type { GoogleDetailsResponse } from '@trippy/domain'
import type { LivePlace, SyncClient } from '@trippy/sync'
import { Button, Card, Notice } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import { useNetworkOffline } from '../sync/use-network-gate'
import { getPlacesErrorMessage, type PlacesClient } from './places-client'

const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

export function GoogleDetailsPanel({
  place,
  tripId,
  syncClient,
  placesClient,
  canConfirm,
  onConfirmed,
}: {
  place: LivePlace
  tripId: string
  syncClient: SyncClient
  placesClient: PlacesClient
  canConfirm: boolean
  onConfirmed: () => Promise<void>
}) {
  const theme = useTheme()
  const isOffline = useNetworkOffline()
  const requestGeneration = useRef(0)
  const [isOpen, setIsOpen] = useState(false)
  const [details, setDetails] = useState<GoogleDetailsResponse | null>(null)
  const [candidateIndex, setCandidateIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [networkUnavailable, setNetworkUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [photoFailed, setPhotoFailed] = useState(false)

  useEffect(() => {
    if (!isOffline) return
    requestGeneration.current += 1
    setDetails(null)
    setIsLoading(false)
    setNetworkUnavailable(false)
    setError(null)
    setPhotoFailed(false)
  }, [isOffline])

  useEffect(
    () => () => {
      requestGeneration.current += 1
    },
    [],
  )

  const loadDetails = useCallback(
    async (googlePlaceId?: string, nextIndex = 0) => {
      setIsOpen(true)
      setDetails(null)
      setError(null)
      setActionError(null)
      setNetworkUnavailable(false)
      setPhotoFailed(false)
      setCandidateIndex(nextIndex)

      if (isOffline) {
        setNetworkUnavailable(true)
        return
      }

      const generation = ++requestGeneration.current
      setIsLoading(true)
      try {
        const response = await placesClient.googleDetails(tripId, place.id, googlePlaceId)
        if (requestGeneration.current !== generation) return
        setDetails(response)
        if (googlePlaceId === undefined) setCandidateIndex(0)
      } catch (requestError) {
        if (requestGeneration.current !== generation) return
        if (requestError instanceof TypeError) setNetworkUnavailable(true)
        else setError(getPlacesErrorMessage(requestError))
      } finally {
        if (requestGeneration.current === generation) setIsLoading(false)
      }
    },
    [isOffline, placesClient, place.id, tripId],
  )

  const openLink = async (uri: string) => {
    setLinkError(null)
    try {
      await Linking.openURL(uri)
    } catch {
      setLinkError('Não foi possível abrir este link neste aparelho.')
    }
  }

  const saveMatch = async (googlePlaceId: string | null) => {
    if (!canConfirm) return
    setIsSaving(true)
    setActionError(null)
    try {
      await syncClient.linkGooglePlace(tripId, place.id, googlePlaceId)
      await onConfirmed()
      setDetails(null)
      setIsOpen(false)
    } catch (saveError) {
      setActionError(getPlacesErrorMessage(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  const current = details?.current
  const photo = current?.photo
  const hasNextCandidate = details !== null && candidateIndex + 1 < details.candidateIds.length

  return (
    <View style={{ gap: theme.spacing.space3 }}>
      <Button
        label="Detalhes do Google"
        onPress={() => {
          if (isOpen) setIsOpen(false)
          else void loadDetails()
        }}
        variant="secondary"
        testID={`google-details-button-${place.id}`}
      />

      {isOpen ? (
        <Card testID={`google-details-block-${place.id}`}>
          <View style={{ gap: theme.spacing.space3 }}>
            <TypographyText
              family="sans"
              style={[typography.bodyStrong, { color: theme.colors.ink }]}
              testID="google-maps-brand"
            >
              Google Maps
            </TypographyText>

            {isOffline || networkUnavailable ? (
              <Notice
                testID={`google-details-offline-${place.id}`}
                tone="warning"
                message="Detalhes do Google indisponíveis sem internet."
              />
            ) : null}
            {isLoading ? (
              <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
                Carregando detalhes do Google...
              </TypographyText>
            ) : null}
            {error ? (
              <Notice testID={`google-details-error-${place.id}`} tone="warning" message={error} />
            ) : null}

            {current && !isOffline && !networkUnavailable ? (
              <View
                testID={`google-details-content-${place.id}`}
                style={{ gap: theme.spacing.space3 }}
              >
                <View style={{ gap: theme.spacing.space1 }}>
                  <TypographyText family="sans" style={{ color: theme.colors.ink }}>
                    {current.name}
                  </TypographyText>
                  {current.type ? (
                    <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
                      {current.type}
                    </TypographyText>
                  ) : null}
                  {current.address ? (
                    <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
                      {current.address}
                    </TypographyText>
                  ) : null}
                </View>

                {photo && !photoFailed ? (
                  <View style={{ gap: theme.spacing.space2 }}>
                    <Image
                      testID={`google-place-photo-${place.id}`}
                      source={{ uri: photo.uri }}
                      style={{ width: '100%', height: 180, borderRadius: 12 }}
                      contentFit="cover"
                      cachePolicy="none"
                      accessibilityLabel={`Foto de ${current.name}`}
                      onError={() => setPhotoFailed(true)}
                    />
                    {photo.authorAttributions.map((author, index) => (
                      <Button
                        key={`${author.uri}-${index}`}
                        label={author.displayName}
                        onPress={() => void openLink(author.uri)}
                        variant="secondary"
                        testID={`google-photo-author-${place.id}-${index}`}
                      />
                    ))}
                  </View>
                ) : null}

                <Button
                  label="Abrir no Google Maps"
                  onPress={() => void openLink(current.googleMapsUri)}
                  variant="secondary"
                  testID={`open-google-maps-${place.id}`}
                />

                {canConfirm ? (
                  <View style={{ gap: theme.spacing.space2 }}>
                    <TypographyText family="sans" style={{ color: theme.colors.ink }}>
                      É este lugar?
                    </TypographyText>
                    <View style={{ flexDirection: 'row', gap: theme.spacing.space2 }}>
                      <Button
                        label="Sim"
                        onPress={() => void saveMatch(current.googlePlaceId)}
                        loading={isSaving}
                        disabled={isSaving}
                        testID={`google-confirm-yes-${place.id}`}
                      />
                      <Button
                        label="Não"
                        onPress={() => void saveMatch(null)}
                        disabled={isSaving}
                        variant="secondary"
                        testID={`google-confirm-no-${place.id}`}
                      />
                    </View>
                  </View>
                ) : null}
                {hasNextCandidate ? (
                  <Button
                    label="Ver outro candidato"
                    onPress={() => {
                      const nextIndex = candidateIndex + 1
                      const googlePlaceId = details?.candidateIds[nextIndex]
                      if (googlePlaceId) void loadDetails(googlePlaceId, nextIndex)
                    }}
                    variant="secondary"
                    testID={`google-next-candidate-${place.id}`}
                  />
                ) : null}
              </View>
            ) : null}
            {actionError ? (
              <Notice
                testID={`google-confirm-error-${place.id}`}
                tone="danger"
                message={actionError}
              />
            ) : null}
            {linkError ? (
              <Notice testID={`google-link-error-${place.id}`} tone="warning" message={linkError} />
            ) : null}
          </View>
        </Card>
      ) : null}
    </View>
  )
}
