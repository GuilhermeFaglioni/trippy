import { Pressable } from 'react-native'

import { useTheme } from '../theme-provider'
import { Text } from './text'

export type TextButtonProps = {
  label: string
  onPress: () => void
  /** `onForest`: texto claro sobre fundo forest; `danger`: vermelho (Sair do grupo). */
  tone?: 'ink' | 'onForest' | 'danger'
  /** Ocupa a largura toda, com o texto centralizado (Cancelar numa folha). */
  block?: boolean
  disabled?: boolean
  accessibilityHint?: string
  locale?: string
  testID?: string
}

/** Ação de texto sem caixa ("Cancelar", "Entrar com e-mail"): 44px de altura, sem borda. */
export function TextButton({
  label,
  onPress,
  tone = 'ink',
  block = false,
  disabled = false,
  accessibilityHint,
  locale,
  testID,
}: TextButtonProps) {
  const { colors, spacing } = useTheme()
  const color =
    tone === 'onForest' ? colors.onForest : tone === 'danger' ? colors.danger : colors.ink

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        alignSelf: 'flex-start',
        justifyContent: 'center',
        minHeight: spacing.targetMin,
        opacity: pressed || disabled ? 0.6 : 1,
        ...(tone === 'onForest' || block ? { alignSelf: 'stretch' } : {}),
      })}
    >
      <Text variant="fieldInput" color={color} locale={locale} style={{ textAlign: 'center' }}>
        {label}
      </Text>
    </Pressable>
  )
}
