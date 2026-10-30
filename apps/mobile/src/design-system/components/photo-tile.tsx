import { Pressable, View } from 'react-native'

import { useTheme } from '../theme-provider'
import { Icon } from './icon'
import { Text } from './text'

export type PhotoTileProps = {
  /** `add`: tracejado com "+"; `photo`: placeholder colorido; `more`: "+N" sobre o último. */
  kind: 'add' | 'photo' | 'more'
  /** Cor do placeholder (paleta `photo-1..4`). */
  tone?: 1 | 2 | 3 | 4
  /** `more`: o "+9". */
  label?: string
  accessibilityLabel?: string
  onPress?: () => void
  testID?: string
}

const SIZE = 72

export function PhotoTile({
  kind,
  tone = 1,
  label,
  accessibilityLabel,
  onPress,
  testID,
}: PhotoTileProps) {
  const { colors, radius } = useTheme()
  const background =
    kind === 'add'
      ? colors.surface
      : [colors.photo1, colors.photo2, colors.photo3, colors.photo4][tone - 1]
  const style = {
    alignItems: 'center',
    backgroundColor: background,
    borderColor: colors.lineStrong,
    borderRadius: radius.radiusSm,
    borderStyle: 'dashed',
    borderWidth: kind === 'add' ? 1 : 0,
    height: SIZE,
    justifyContent: 'center',
    width: SIZE,
  } as const
  const content =
    kind === 'add' ? (
      <Icon name="plus" color={colors.ink} size={22} />
    ) : kind === 'more' ? (
      <Text variant="count" color={colors.ink}>
        {label ?? ''}
      </Text>
    ) : null

  if (!onPress) {
    return (
      <View testID={testID} style={style}>
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
      style={style}
    >
      {content}
    </Pressable>
  )
}
