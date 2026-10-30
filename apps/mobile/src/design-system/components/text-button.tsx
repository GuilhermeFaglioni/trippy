import { Pressable } from 'react-native'

import { useTheme } from '../theme-provider'
import { Text } from './text'

export type TextButtonProps = {
  label: string
  onPress: () => void
  accessibilityHint?: string
  locale?: string
  testID?: string
}

/** Ação de texto sem caixa (ex.: Cancelar no topo de um fluxo modal). */
export function TextButton({ label, onPress, accessibilityHint, locale, testID }: TextButtonProps) {
  const { colors, spacing } = useTheme()

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={{
        alignItems: 'center',
        alignSelf: 'flex-start',
        justifyContent: 'center',
        minHeight: spacing.targetMin,
      }}
    >
      <Text variant="fieldInput" color={colors.ink} locale={locale}>
        {label}
      </Text>
    </Pressable>
  )
}
