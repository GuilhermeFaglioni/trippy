import { useCallback, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  Button,
  CoverPicker,
  Notice,
  Text,
  TextButton,
  TextField,
  useTheme,
} from '../../design-system'
import { useSync } from '../sync/sync-provider'
import { parseDateInput } from './trip-format'
import { getTripsErrorMessage, useTripsClient, type CreateTripInput } from './trips-client'

type TripFormValues = {
  name: string
  destination: string
  startDate: string
  endDate: string
}

type TripFormErrors = Partial<Record<keyof TripFormValues, string>>

const DATE_ERROR = 'Informe uma data válida, como 12 out 2026.'

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function validateTrip(
  values: TripFormValues,
  timezone: string,
): { errors: TripFormErrors; input: CreateTripInput | null } {
  const errors: TripFormErrors = {}
  const name = values.name.trim()
  const destination = values.destination.trim()
  const startDate = parseDateInput(values.startDate)
  const endDate = parseDateInput(values.endDate)

  if (!name) errors.name = 'Informe o nome da viagem.'
  else if (name.length > 120) errors.name = 'Use até 120 caracteres no nome da viagem.'

  if (!destination) errors.destination = 'Informe o destino.'
  else if (destination.length > 120) errors.destination = 'Use até 120 caracteres no destino.'

  if (!startDate) errors.startDate = DATE_ERROR
  if (!endDate) errors.endDate = DATE_ERROR
  if (startDate && endDate && endDate < startDate) {
    errors.endDate = 'A volta deve ser no mesmo dia da ida ou depois.'
  }

  if (Object.keys(errors).length > 0 || !startDate || !endDate) {
    return { errors, input: null }
  }

  return { errors, input: { name, destination, startDate, endDate, timezone } }
}

export function NewTripScreen() {
  const theme = useTheme()
  const router = useRouter()
  const client = useTripsClient()
  const { client: syncClient, rememberTripId } = useSync()
  const [timezone] = useState(deviceTimeZone)
  const [values, setValues] = useState<TripFormValues>({
    name: '',
    destination: '',
    startDate: '',
    endDate: '',
  })
  const [errors, setErrors] = useState<TripFormErrors>({})
  const [apiError, setApiError] = useState<string | null>(null)
  const [coverHint, setCoverHint] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const updateField = useCallback((field: keyof TripFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setApiError(null)
  }, [])

  const submit = useCallback(async () => {
    const validation = validateTrip(values, timezone)
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
  }, [client, rememberTripId, router, syncClient, timezone, values])

  return (
    <SafeAreaView
      testID="new-trip-screen"
      style={{ flex: 1, backgroundColor: theme.colors.ground }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          gap: theme.spacing.space5,
          paddingBottom: theme.spacing.space4,
          paddingHorizontal: theme.spacing.space5,
          paddingTop: theme.spacing.space1,
        }}
      >
        <TextButton label="Cancelar" onPress={() => router.back()} testID="new-trip-back" />
        <Text variant="titleL" color={theme.colors.ink} accessibilityRole="header">
          Pra onde vocês vão?
        </Text>

        <CoverPicker
          label="Adicionar capa (opcional · dá para trocar depois)"
          onPress={() => setCoverHint(true)}
          testID="new-trip-cover"
        />
        {coverHint ? (
          <Notice
            testID="new-trip-cover-hint"
            tone="offline"
            segments={['Capas chegam numa próxima versão. Por enquanto a viagem usa uma cor.']}
          />
        ) : null}

        {apiError ? (
          <Notice
            testID="new-trip-api-error"
            tone="change"
            segments={[{ strong: 'Não foi possível criar a viagem.' }, ' ', apiError]}
          />
        ) : null}

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
          placeholder="Cidade ou país"
          maxLength={120}
          autoCapitalize="words"
          testID="new-trip-destination"
        />
        <View style={{ flexDirection: 'row', gap: theme.spacing.space3 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <TextField
              label="Ida"
              value={values.startDate}
              onChangeText={(value) => updateField('startDate', value)}
              error={errors.startDate}
              placeholder="12 out 2026"
              testID="new-trip-start-date"
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <TextField
              label="Volta"
              value={values.endDate}
              onChangeText={(value) => updateField('endDate', value)}
              error={errors.endDate}
              placeholder="24 out 2026"
              testID="new-trip-end-date"
            />
          </View>
        </View>
        <Text variant="fieldHelp" color={theme.colors.inkMuted} style={{ lineHeight: 19 }}>
          A viagem muda de fase sozinha pelas datas: planejando, em viagem e encerrada.
        </Text>

        <View style={{ flexGrow: 1 }} />
        <Button
          label="Criar viagem"
          onPress={() => void submit()}
          loading={isSubmitting}
          testID="new-trip-submit"
        />
      </ScrollView>
    </SafeAreaView>
  )
}
