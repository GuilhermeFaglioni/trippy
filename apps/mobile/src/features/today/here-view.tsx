import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  InfoNote,
  Button,
  Card,
  PlaceResult,
  Text,
  TextButton,
  TextField,
  useTheme,
} from '../../design-system'

export type HereCandidateView = {
  key: string
  name: string
  localName: string | null
  /** "a 40 m · pelo GPS do celular". */
  detail: string
}

/** `searching`: lendo o GPS ou buscando; `no-gps`: sem permissão/sinal; `no-results`: busca falhou. */
export type HerePhase = 'searching' | 'candidates' | 'no-gps' | 'no-results'

export type HereViewProps = {
  phase: HerePhase
  candidates: readonly HereCandidateView[]
  selectedKey: string | null
  name: string
  nameError: string | null
  error: string | null
  busy: boolean
  canSubmit: boolean
  footer?: ReactNode
  onCancel: () => void
  onSelect: (key: string) => void
  onChangeName: (value: string) => void
  onRetryLocation: () => void
  onSubmit: () => void
}

const NOTE_WITH_GPS =
  'Na China a busca de lugares pode não funcionar. O app guarda a sua localização aproximada e o nome que você digitar; o endereço pode ser completado depois.'
const NOTE_WITHOUT_GPS =
  'Sem localização, o lugar fica registrado só com o nome que você digitar. O organizador pode completar o endereço depois.'

export function HereView({
  phase,
  candidates,
  selectedKey,
  name,
  nameError,
  error,
  busy,
  canSubmit,
  footer,
  onCancel,
  onSelect,
  onChangeName,
  onRetryLocation,
  onSubmit,
}: HereViewProps) {
  const { colors, radius, spacing } = useTheme()

  return (
    <SafeAreaView testID="hoje-aqui" style={{ flex: 1, backgroundColor: colors.ground }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            gap: spacing.space4,
            paddingBottom: spacing.space5,
            paddingHorizontal: spacing.space5,
            paddingTop: spacing.space2,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <TextButton label="Cancelar" onPress={onCancel} testID="hoje-aqui-cancelar" />
          <Text variant="titleL" color={colors.ink} accessibilityRole="header">
            Estamos aqui
          </Text>
          <Text variant="body" color={colors.inkMuted}>
            Registre um lugar fora do roteiro. Ele entra no dia de hoje como visitado.
          </Text>

          {phase === 'searching' ? (
            <Card testID="hoje-aqui-buscando">
              <Text variant="label" color={colors.inkMuted}>
                Perto de você
              </Text>
              <Text variant="bodySm" color={colors.inkMuted}>
                Lendo sua localização e buscando lugares por perto...
              </Text>
            </Card>
          ) : null}

          {phase === 'no-gps' || phase === 'no-results' ? (
            <View
              testID={phase === 'no-gps' ? 'hoje-aqui-sem-localizacao' : 'hoje-aqui-busca-falhou'}
              style={{
                backgroundColor: colors.terracottaTint,
                borderRadius: radius.radiusMd,
                gap: spacing.space2,
                padding: 14,
              }}
            >
              <Text variant="placeName" color={colors.terracottaInk}>
                {phase === 'no-gps' ? 'Sem localização' : 'Sem lugares por perto'}
              </Text>
              <Text variant="bodySm" color={colors.ink}>
                {phase === 'no-gps'
                  ? 'O app não tem permissão de localização ou o GPS está sem sinal. Digite o nome do lugar abaixo; dá para completar o endereço depois.'
                  : 'Não conseguimos buscar lugares perto de você. Digite o nome do lugar abaixo; dá para completar o endereço depois.'}
              </Text>
              {phase === 'no-gps' ? (
                <Button
                  label="Permitir localização"
                  variant="secondary"
                  onPress={onRetryLocation}
                  testID="hoje-aqui-gps"
                />
              ) : null}
            </View>
          ) : null}

          {phase === 'candidates' ? (
            <Card
              testID="hoje-aqui-candidatos"
              style={{ borderRadius: radius.radiusLg, padding: 14 }}
            >
              <Text variant="label" color={colors.inkMuted} accessibilityRole="header">
                Perto de você
              </Text>
              {candidates.map((candidate, index) => (
                <PlaceResult
                  key={candidate.key}
                  testID={`hoje-aqui-candidato-${index}`}
                  compact
                  name={candidate.name}
                  localName={candidate.localName}
                  detail={candidate.detail}
                  selected={candidate.key === selectedKey}
                  disabled={busy}
                  onPress={() => onSelect(candidate.key)}
                />
              ))}
              <Text variant="caption" color={colors.inkMuted}>
                Se a busca de lugares falhar (comum na China), aparece só &quot;Onde você está
                agora&quot;, sem nome; você digita o nome abaixo.
              </Text>
              {footer}
            </Card>
          ) : null}

          <TextField
            label="Ou digite um nome"
            value={name}
            onChangeText={onChangeName}
            error={nameError ?? undefined}
            placeholder="Ex.: barraca de bolinho na esquina"
            maxLength={120}
            autoCapitalize="words"
            testID="hoje-aqui-nome"
          />

          <InfoNote testID="hoje-aqui-nota">
            {phase === 'candidates' ? NOTE_WITH_GPS : NOTE_WITHOUT_GPS}
          </InfoNote>

          {error ? (
            <Text variant="bodySm" color={colors.danger} testID="hoje-aqui-erro">
              {error}
            </Text>
          ) : null}

          <View style={{ flex: 1 }} />
          <Button
            label={'Registrar e marcar "Eu fui"'}
            onPress={onSubmit}
            loading={busy}
            disabled={!canSubmit}
            testID="hoje-aqui-registrar"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
