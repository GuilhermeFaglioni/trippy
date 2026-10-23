import { useEffect, useState } from 'react'
import { View } from 'react-native'

import { classifyLocalDetail } from '@trippy/domain'
import type { LocalDetailStatus } from '@trippy/domain'
import type { LivePlace, SyncClient } from '@trippy/sync'
import { Button, Notice, TextField } from '../../components'
import { TypographyText, useTheme } from '../../design-system'

function statusMessage(status: LocalDetailStatus, label: string): string | null {
  if (status === 'missing') return `${label} local ausente. Você pode salvar com essa pendência.`
  if (status === 'incomplete')
    return `${label} local parece incompleto. Você pode salvar com essa pendência.`
  if (status === 'not_local_language') {
    return `${label} local pode não estar no idioma do destino. Você pode salvar com essa pendência.`
  }
  return null
}

function initialValue(userValue: string | null, providerValue: string | null): string {
  return userValue ?? providerValue ?? ''
}

export function LocalDetailsEditor({
  place,
  tripId,
  client,
  onSaved,
}: {
  place: LivePlace
  tripId: string
  client: SyncClient
  onSaved: () => Promise<void>
}) {
  const theme = useTheme()
  const [localName, setLocalName] = useState(() =>
    initialValue(place.userLocalName, place.localName),
  )
  const [localAddress, setLocalAddress] = useState(() =>
    initialValue(place.userLocalAddress, place.localAddress),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  useEffect(() => {
    setLocalName(initialValue(place.userLocalName, place.localName))
    setLocalAddress(initialValue(place.userLocalAddress, place.localAddress))
  }, [place.localAddress, place.localName, place.userLocalAddress, place.userLocalName])

  const countryCode = place.countryCode
  const nameStatus = classifyLocalDetail({
    userValue: localName,
    providerValue: place.localName,
    countryCode,
    kind: 'name',
  })
  const addressStatus = classifyLocalDetail({
    userValue: localAddress,
    providerValue: place.localAddress,
    countryCode,
    kind: 'address',
  })

  const save = async () => {
    setIsSaving(true)
    setSaveError(null)
    setSaveMessage(null)
    try {
      await client.setLocalDetails(tripId, place.id, {
        localName: localName.trim() || null,
        localAddress: localAddress.trim() || null,
      })
      setSaveMessage('Nome e endereço locais salvos.')
      await onSaved()
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Não foi possível salvar os dados locais.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const nameWarning = statusMessage(nameStatus, 'Nome')
  const addressWarning = statusMessage(addressStatus, 'Endereço')

  return (
    <View testID="local-details-editor" style={{ gap: theme.spacing.space3 }}>
      <TypographyText family="sans" style={{ color: theme.colors.ink }}>
        Nome e endereço locais
      </TypographyText>
      <TextField
        label="Nome local"
        value={localName}
        onChangeText={(value) => {
          setLocalName(value)
          setSaveMessage(null)
        }}
        maxLength={120}
        testID={`local-name-${place.id}`}
      />
      {nameWarning ? (
        <Notice testID={`local-name-warning-${place.id}`} tone="warning" message={nameWarning} />
      ) : null}
      <TextField
        label="Endereço local"
        value={localAddress}
        onChangeText={(value) => {
          setLocalAddress(value)
          setSaveMessage(null)
        }}
        maxLength={240}
        testID={`local-address-${place.id}`}
      />
      {addressWarning ? (
        <Notice
          testID={`local-address-warning-${place.id}`}
          tone="warning"
          message={addressWarning}
        />
      ) : null}
      {saveError ? (
        <Notice testID={`local-details-error-${place.id}`} tone="danger" message={saveError} />
      ) : null}
      {saveMessage ? (
        <TypographyText family="sans" style={{ color: theme.colors.forest }}>
          {saveMessage}
        </TypographyText>
      ) : null}
      <Button
        label="Salvar dados locais"
        onPress={() => void save()}
        loading={isSaving}
        testID={`save-local-details-${place.id}`}
      />
    </View>
  )
}
