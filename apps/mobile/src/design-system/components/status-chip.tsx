import { Pressable, View } from 'react-native'

import { useTheme } from '../theme-provider'
import { Text } from './text'

export type StatusChipTone = 'day' | 'suggested' | 'none' | 'live'

export type StatusChipProps = {
  tone: StatusChipTone
  /** Sempre texto: a cor nunca é o único sinal. */
  label: string
  /** Presente: botão que abre a folha de dias (organizador). Ausente: só o status (membros). */
  onPress?: () => void
  testID?: string
}

export function StatusChip({ tone, label, onPress, testID }: StatusChipProps) {
  const { colors, radius, spacing } = useTheme()
  const palette = {
    day: { background: colors.forestTint, foreground: colors.forestInk },
    suggested: { background: colors.terracottaTint, foreground: colors.terracottaInk },
    live: { background: colors.terracotta, foreground: colors.onTerracotta },
    none: { background: colors.sand, foreground: colors.inkMuted },
  }[tone]

  const chipStyle = {
    alignSelf: 'flex-start',
    backgroundColor: palette.background,
    borderRadius: radius.radiusPill,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 3,
  } as const

  if (!onPress) {
    return (
      <View testID={testID} accessible accessibilityLabel={label} style={chipStyle}>
        <Text variant="chip" color={palette.foreground}>
          {label}
        </Text>
      </View>
    )
  }

  // Visual de 32px; hitSlop completa os 44px sem aumentar o desenho.
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: spacing.space1 / 2, right: spacing.space1 / 2 }}
      style={({ pressed }) => ({
        ...chipStyle,
        minHeight: 32,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text variant="chip" color={palette.foreground}>
        {label}
      </Text>
    </Pressable>
  )
}
