import { Pressable, View } from 'react-native'

import { useTheme } from '../theme-provider'
import { Icon } from './icon'
import { Text } from './text'

export type CoverPickerProps = {
  label: string
  onPress: () => void
  testID?: string
}

/** Área tracejada "Adicionar capa": 96px de altura, borda `line-strong` tracejada. */
export function CoverPicker({ label, onPress, testID }: CoverPickerProps) {
  const { colors, radius, spacing } = useTheme()

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        backgroundColor: pressed ? colors.hairline : colors.sand,
        borderColor: colors.lineStrong,
        borderRadius: radius.radiusLg,
        borderStyle: 'dashed',
        borderWidth: 1,
        justifyContent: 'center',
        minHeight: 96,
        paddingHorizontal: spacing.space4,
        paddingVertical: spacing.space2,
      })}
    >
      <View style={{ alignItems: 'center', gap: spacing.space2 }}>
        <Icon name="image" color={colors.ink} size={28} strokeWidth={1.8} />
        <Text
          variant="body"
          color={colors.ink}
          style={{ fontSize: 15, fontWeight: '500', textAlign: 'center' }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  )
}
