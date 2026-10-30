import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { useTheme } from '../theme-provider'
import { FocusRing } from './focus-ring'
import { Icon, type IconName } from './icon'

export type CircleButtonProps = {
  icon: IconName
  /** Obrigatório: o botão não tem texto visível. */
  accessibilityLabel: string
  onPress: () => void
  testID?: string
}

/** Botão redondo de 44px sobre capa ou fundo escuro (voltar, fechar). */
export function CircleButton({ icon, accessibilityLabel, onPress, testID }: CircleButtonProps) {
  const { colors, radius, spacing } = useTheme()
  const [focused, setFocused] = useState(false)

  return (
    <View style={{ width: spacing.targetMin, height: spacing.targetMin }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed }) => ({
          alignItems: 'center',
          backgroundColor: pressed ? colors.sand : colors.ground,
          borderRadius: radius.radiusPill,
          height: spacing.targetMin,
          justifyContent: 'center',
          width: spacing.targetMin,
        })}
      >
        <Icon name={icon} color={colors.ink} size={18} strokeWidth={2.2} />
      </Pressable>
      {focused ? (
        <FocusRing
          radius={radius.radiusPill}
          testID={testID ? `${testID}-focus-ring` : undefined}
        />
      ) : null}
    </View>
  )
}
