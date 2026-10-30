import { Pressable } from 'react-native'

import { useTheme } from '../theme-provider'
import { Text } from './text'

export type TextButtonProps = {
  label: string
  onPress: () => void
  /** `onForest`: texto claro sobre fundo forest. */
  tone?: 'ink' | 'onForest'
  disabled?: boolean
  testID?: string
}

/** Ação de texto sem caixa ("Cancelar", "Entrar com e-mail"): 44px de altura, sem borda. */
export function TextButton({
  label,
  onPress,
  tone = 'ink',
  disabled = false,
  testID,
}: TextButtonProps) {
  const { colors, spacing } = useTheme()
  const color = tone === 'onForest' ? colors.onForest : colors.ink

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        alignSelf: 'flex-start',
        justifyContent: 'center',
        minHeight: spacing.targetMin,
        opacity: pressed || disabled ? 0.6 : 1,
        ...(tone === 'onForest' ? { alignSelf: 'stretch' } : {}),
      })}
    >
      <Text variant="fieldInput" color={color} style={{ textAlign: 'center' }}>
        {label}
      </Text>
    </Pressable>
  )
}
