import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Platform, ScrollView, View } from 'react-native'
import { setStringAsync } from 'expo-clipboard'
import { useKeepAwake } from 'expo-keep-awake'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { LivePlace } from '@trippy/sync'
import { Button, CircleButton, Notice, Text, useTheme } from '../../design-system'
import { useSync } from '../sync/sync-provider'
import { addressCardState } from './address-card-model'
import { mapUrl } from './map-link'

/**
 * Cartão para mostrar (referência `07-cartao-para-mostrar`), em tela cheia e sem rede.
 * TestIDs Maestro: address-card, address-card-name, address-card-address, address-card-close,
 * address-card-complete, address-card-copy, address-card-map.
 */
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
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { client } = useSync()
  const [place, setPlace] = useState<LivePlace | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [copied, setCopied] = useState(false)

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
  const address = state !== null && state.kind !== 'empty' ? state.address : null

  const copyAddress = () => {
    if (address === null) return
    void setStringAsync(address).then(() => setCopied(true))
  }

  const openMap = () => {
    if (place === null || state === null) return
    const query = address ?? state.name
    void Linking.openURL(mapUrl(place, query, Platform.OS === 'android' ? 'android' : 'ios'))
  }

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        flex: 1,
        gap: theme.spacing.space5,
        paddingBottom: Math.max(insets.bottom, theme.spacing.space4) + theme.spacing.space4,
        paddingHorizontal: theme.spacing.space6,
        paddingTop: insets.top + theme.spacing.space2,
      }}
    >
      <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }}>
        <CircleButton
          icon="x"
          accessibilityLabel="Fechar"
          onPress={onClose}
          testID="address-card-close"
        />
        <Text variant="notice" color={theme.colors.inkMuted}>
          Guardado no celular · funciona sem internet
        </Text>
      </View>

      <ScrollView
        testID="address-card"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
      >
        {isLoading ? (
          <ActivityIndicator color={theme.colors.ink} testID="address-card-loading" />
        ) : state === null ? (
          <Notice
            testID="address-card-missing"
            tone="offline"
            segments={['Lugar não encontrado.']}
          />
        ) : state.kind === 'empty' ? (
          <View style={{ gap: theme.spacing.space4 }}>
            <Text
              variant="hero"
              color={theme.colors.ink}
              testID="address-card-name"
              style={{ lineHeight: 42 }}
            >
              {state.name}
            </Text>
            <Notice
              testID="address-card-empty"
              tone="change"
              segments={[
                { strong: 'Este lugar ainda não tem endereço. ' },
                'Peça ao organizador para completar, ou mostre no mapa.',
              ]}
            />
            <Button
              label="Completar endereço"
              onPress={onComplete}
              testID="address-card-complete"
            />
          </View>
        ) : state.kind === 'vendor' ? (
          <View style={{ gap: theme.spacing.space4 }}>
            <Text
              variant="hero"
              color={theme.colors.ink}
              testID="address-card-name"
              style={{ lineHeight: 42 }}
            >
              {state.name}
            </Text>
            <Text
              variant="body"
              color={theme.colors.ink}
              testID="address-card-address"
              style={{ fontSize: 18, lineHeight: 25 }}
            >
              {state.address}
            </Text>
            <Notice
              testID="address-card-vendor-note"
              tone="change"
              segments={[
                { strong: 'Sem endereço no idioma local. ' },
                'Endereço do fornecedor, não está no idioma local: motoristas podem não conseguir ler. Peça ao organizador para completar, ou mostre no mapa.',
              ]}
            />
          </View>
        ) : (
          <View style={{ gap: 28 }}>
            <Text variant="cardName" color={theme.colors.ink} testID="address-card-name">
              {state.name}
            </Text>
            <Text variant="cardAddress" color={theme.colors.ink} testID="address-card-address">
              {state.address}
            </Text>
            <View style={{ backgroundColor: theme.colors.hairline, height: 1 }} />
            <View>
              <Text variant="titleS" color={theme.colors.ink}>
                {place?.name ?? ''}
              </Text>
              {place?.address ? (
                <Text variant="body" color={theme.colors.inkMuted}>
                  {place.address}
                </Text>
              ) : null}
            </View>
          </View>
        )}
      </ScrollView>

      <View style={{ gap: theme.spacing.space3 }}>
        <Text variant="caption" color={theme.colors.inkMuted} style={{ textAlign: 'center' }}>
          Sem internet, o mapa abre só se já estiver baixado no app de mapas.
        </Text>
        <View style={{ alignItems: 'flex-start', flexDirection: 'row', gap: theme.spacing.space3 }}>
          <View style={{ flex: 1 }}>
            <Button
              label={copied ? 'Endereço copiado' : 'Copiar endereço'}
              variant="secondary"
              block
              disabled={address === null}
              onPress={copyAddress}
              testID="address-card-copy"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Abrir no mapa"
              variant="forest"
              disabled={state === null}
              onPress={openMap}
              testID="address-card-map"
            />
          </View>
        </View>
        <Text variant="caption" color={theme.colors.inkMuted} style={{ textAlign: 'center' }}>
          {
            '"Abrir no mapa" usa o app de mapas padrão do celular: Apple Maps no iPhone, Google Maps ou Amap no Android.'
          }
        </Text>
      </View>
    </View>
  )
}
