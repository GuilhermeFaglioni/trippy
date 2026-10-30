import { Pressable } from 'react-native'

import { useTheme } from '../theme-provider'
import { Text } from './text'

export type TextLinkProps = {
  label: string
  onPress: () => void
  accessibilityLabel?: string
  /** Texto sem a altura de 44px (dentro de um card); o alvo de toque continua com `hitSlop`. */
  compact?: boolean
  testID?: string
}

/** Ação em texto terracotta ("Ver todas", "Escrever"), com alvo de 44px. */
export function TextLink({
  label,
  onPress,
  accessibilityLabel,
  compact = false,
  testID,
}: TextLinkProps) {
  const { colors, spacing } = useTheme()

  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={compact ? { top: 12, bottom: 12, left: 12, right: 12 } : undefined}
      style={{ justifyContent: 'center', minHeight: compact ? 16 : spacing.targetMin }}
    >
      <Text
        variant="count"
        color={colors.terracottaText}
        style={{ textDecorationLine: 'underline' }}
      >
        {label}
      </Text>
    </Pressable>
  )
}
