import { Pressable } from 'react-native'

import { useTheme } from '../theme-provider'
import { Text } from './text'

export type FilterChipProps = {
  /** Pode trazer a contagem ("Sugeridos 6"). */
  label: string
  selected: boolean
  onPress: () => void
  testID?: string
}

export function FilterChip({ label, selected, onPress, testID }: FilterChipProps) {
  const { colors, radius } = useTheme()

  // Visual de 36px; hitSlop vertical completa os 44px.
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => ({
        alignItems: 'center',
        backgroundColor: selected ? colors.ink : pressed ? colors.sand : 'transparent',
        borderColor: selected ? colors.ink : colors.lineStrong,
        borderRadius: radius.radiusPill,
        borderWidth: 1,
        height: 36,
        justifyContent: 'center',
        paddingHorizontal: 14,
      })}
    >
      <Text
        variant={selected ? 'filterSelected' : 'filter'}
        color={selected ? colors.ground : colors.ink}
      >
        {label}
      </Text>
    </Pressable>
  )
}
