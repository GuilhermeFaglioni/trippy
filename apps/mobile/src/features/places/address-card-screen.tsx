import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, ScrollView, View } from 'react-native'
import { useKeepAwake } from 'expo-keep-awake'
import { SafeAreaView } from 'react-native-safe-area-context'

import type { LivePlace } from '@trippy/sync'
import { Button, Notice } from '../../components'
import { createTypographyTokens, normalizeFontPlatform, TypographyText } from '../../design-system'
import { useSync } from '../sync/sync-provider'
import { addressCardState } from './address-card-model'

/** TestIDs Maestro: address-card, address-card-name, address-card-address, address-card-close, address-card-complete. */
const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

const INK = '#000000'
const PAPER = '#FFFFFF'

type AddressCardScreenProps = {
  tripId: string
  placeId: string
  onClose: () => void
  onComplete: () => void
}

export function AddressCardScreen({
  tripId,
  placeId,
  onClose,
  onComplete,
}: AddressCardScreenProps) {
  useKeepAwake()
  const { client } = useSync()
  const [place, setPlace] = useState<LivePlace | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    if (client === null) {
      setIsLoading(false)
      return
    }
    void client
      .listPlaces(tripId)
      .then((places) => {
        if (active) setPlace(places.find((candidate) => candidate.id === placeId) ?? null)
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [client, placeId, tripId])

  const state = place ? addressCardState(place) : null

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PAPER }}>
      <ScrollView
        testID="address-card"
        contentContainerStyle={{ flexGrow: 1, gap: 24, padding: 24 }}
      >
        {isLoading ? (
          <ActivityIndicator color={INK} testID="address-card-loading" />
        ) : state === null ? (
          <Notice testID="address-card-missing" tone="warning" message="Lugar não encontrado." />
        ) : (
          <>
            <TypographyText
              family="local"
              testID="address-card-name"
              style={[typography.titleL, { color: INK }]}
            >
              {state.name}
            </TypographyText>

            {state.kind === 'empty' ? (
              <View style={{ gap: 16 }}>
                <Notice
                  testID="address-card-empty"
                  tone="warning"
                  message="Este lugar ainda não tem endereço."
                />
                <Button
                  label="Completar endereço"
                  onPress={onComplete}
                  testID="address-card-complete"
                />
              </View>
            ) : (
              <View style={{ gap: 16 }}>
                <TypographyText
                  family="local"
                  testID="address-card-address"
                  style={[typography.titleL, { color: INK }]}
                >
                  {state.address}
                </TypographyText>
                {state.kind === 'vendor' ? (
                  <TypographyText
                    family="sans"
                    testID="address-card-vendor-note"
                    style={[typography.bodySm, { color: INK }]}
                  >
                    Endereço do fornecedor, não está no idioma local.
                  </TypographyText>
                ) : null}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <View style={{ padding: 24 }}>
        <Button label="Fechar" onPress={onClose} testID="address-card-close" />
      </View>
    </SafeAreaView>
  )
}
