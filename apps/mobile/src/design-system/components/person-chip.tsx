import { Pressable, View } from 'react-native'

import { useTheme } from '../theme-provider'
import { Icon } from './icon'
import { Text } from './text'

export type PersonChipProps = {
  label: string
  /** `added`: quem já foi (forest-tint); `add`: tracejado "+ marcar". */
  tone?: 'added' | 'add'
  /** Mostra o × de desmarcar (só na pessoa que pode ser desmarcada). */
  removable?: boolean
  /** Ausente: chip só de leitura. */
  onPress?: () => void
  accessibilityLabel?: string
  testID?: string
}

export function PersonChip({
  label,
  tone = 'added',
  removable = false,
  onPress,
  accessibilityLabel,
  testID,
}: PersonChipProps) {
  const { colors, radius } = useTheme()
  const isAdd = tone === 'add'
  const foreground = isAdd ? colors.ink : colors.forestInk
  const style = {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: isAdd ? 'transparent' : colors.forestTint,
    borderColor: colors.lineStrong,
    borderRadius: radius.radiusPill,
    borderStyle: 'dashed',
    borderWidth: isAdd ? 1 : 0,
    flexDirection: 'row',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 10,
  } as const
  const content = (
    <>
      <Text variant={isAdd ? 'filter' : 'filterSelected'} color={foreground}>
        {label}
      </Text>
      {removable ? <Icon name="x" color={foreground} size={12} strokeWidth={3} /> : null}
    </>
  )

  if (!onPress) {
    return (
      <View
        testID={testID}
        accessible
        accessibilityLabel={accessibilityLabel ?? label}
        style={style}
      >
        {content}
      </View>
    )
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => ({ ...style, opacity: pressed ? 0.8 : 1 })}
    >
      {content}
    </Pressable>
  )
}
