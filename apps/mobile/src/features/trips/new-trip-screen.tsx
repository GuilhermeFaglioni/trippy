import { useCallback, useState } from 'react'
import { Platform, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button, Notice, TextField, TrippyWordmark } from '../../components'
import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../../design-system'
import { getTripsErrorMessage, useTripsClient, type CreateTripInput } from './trips-client'
import { useSync } from '../sync/sync-provider'

const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

type TripFormValues = {
  name: string
  destination: string
  startDate: string
  endDate: string
  timezone: string
}

type TripFormErrors = Partial<Record<keyof TripFormValues, string>>

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function dateInputToIso(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim())
  if (!match) return null

  const [, dayText, monthText, yearText] = match
  const day = Number(dayText)
  const month = Number(monthText)
  const year = Number(yearText)
  if (year < 1) return null

  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return `${yearText}-${monthText}-${dayText}`
}

function isValidTimeZone(value: string): boolean {
  if (!value.trim()) return false

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() })
    return true
  } catch {
    return false
  }
}

function validateTrip(values: TripFormValues): {
  errors: TripFormErrors
  input: CreateTripInput | null
} {
  const errors: TripFormErrors = {}
  const name = values.name.trim()
  const destination = values.destination.trim()
  const startDate = dateInputToIso(values.startDate)
  const endDate = dateInputToIso(values.endDate)
  const timezone = values.timezone.trim()

  if (!name) errors.name = 'Informe o nome da viagem.'
  else if (name.length > 120) errors.name = 'Use até 120 caracteres no nome da viagem.'

  if (!destination) errors.destination = 'Informe o destino.'
  else if (destination.length > 120) errors.destination = 'Use até 120 caracteres no destino.'

  if (!startDate) errors.startDate = 'Informe uma data válida no formato DD/MM/AAAA.'
  if (!endDate) errors.endDate = 'Informe uma data válida no formato DD/MM/AAAA.'
  if (startDate && endDate && endDate < startDate) {
    errors.endDate = 'A data de volta deve ser igual ou posterior à data de ida.'
  }

  if (!timezone) errors.timezone = 'Informe o fuso horário da viagem.'
  else if (!isValidTimeZone(timezone)) errors.timezone = 'Informe um fuso horário IANA válido.'

  if (Object.keys(errors).length > 0 || !startDate || !endDate) {
    return { errors, input: null }
  }

  return {
    errors,
    input: { name, destination, startDate, endDate, timezone },
  }
}

export function NewTripScreen() {
  const theme = useTheme()
  const router = useRouter()
  const client = useTripsClient()
  const { client: syncClient, rememberTripId } = useSync()
  const [values, setValues] = useState<TripFormValues>(() => ({
    name: '',
    destination: '',
    startDate: '',
    endDate: '',
    timezone: deviceTimeZone(),
  }))
  const [errors, setErrors] = useState<TripFormErrors>({})
  const [apiError, setApiError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const updateField = useCallback((field: keyof TripFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setApiError(null)
  }, [])

  const submit = useCallback(async () => {
    const validation = validateTrip(values)
    setErrors(validation.errors)
    setApiError(null)
    if (!validation.input) return

    setIsSubmitting(true)
    try {
      const trip = await client.createTrip(validation.input)
      rememberTripId(trip.id)
      if (syncClient !== null) {
        try {
          await syncClient.syncNow()
        } catch {
          // A viagem já existe no servidor; a sincronização tenta novamente depois.
        }
      }
      router.replace('/')
    } catch (error) {
      setApiError(getTripsErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }, [client, rememberTripId, router, syncClient, values])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.ground }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          gap: theme.spacing.space5,
          padding: theme.spacing.space5,
        }}
      >
        <TrippyWordmark />
        <View style={{ gap: theme.spacing.space2 }}>
          <TypographyText family="display" style={[typography.titleL, { color: theme.colors.ink }]}>
            Nova viagem
          </TypographyText>
          <TypographyText family="sans" style={{ color: theme.colors.inkMuted }}>
            Preencha os dados para criar sua viagem.
          </TypographyText>
        </View>

        {apiError ? (
          <Notice
            testID="new-trip-api-error"
            tone="danger"
            title="Não foi possível criar a viagem."
            message={apiError}
          />
        ) : null}

        <View style={{ gap: theme.spacing.space4 }}>
          <TextField
            label="Nome da viagem"
            value={values.name}
            onChangeText={(value) => updateField('name', value)}
            error={errors.name}
            maxLength={120}
            autoCapitalize="sentences"
            testID="new-trip-name"
          />
          <TextField
            label="Destino"
            value={values.destination}
            onChangeText={(value) => updateField('destination', value)}
            error={errors.destination}
            maxLength={120}
            autoCapitalize="words"
            testID="new-trip-destination"
          />
          <TextField
            label="Data de ida"
            value={values.startDate}
            onChangeText={(value) => updateField('startDate', value)}
            error={errors.startDate}
            placeholder="DD/MM/AAAA"
            keyboardType="numbers-and-punctuation"
            testID="new-trip-start-date"
          />
          <TextField
            label="Data de volta"
            value={values.endDate}
            onChangeText={(value) => updateField('endDate', value)}
            error={errors.endDate}
            placeholder="DD/MM/AAAA"
            keyboardType="numbers-and-punctuation"
            testID="new-trip-end-date"
          />
          <TextField
            label="Fuso horário"
            value={values.timezone}
            onChangeText={(value) => updateField('timezone', value)}
            error={errors.timezone}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="America/Sao_Paulo"
            testID="new-trip-timezone"
          />
        </View>

        <View style={{ gap: theme.spacing.space3 }}>
          <Button
            label="Criar viagem"
            onPress={() => void submit()}
            loading={isSubmitting}
            testID="new-trip-submit"
          />
          <Button
            label="Voltar"
            onPress={() => router.back()}
            variant="secondary"
            disabled={isSubmitting}
            testID="new-trip-back"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
