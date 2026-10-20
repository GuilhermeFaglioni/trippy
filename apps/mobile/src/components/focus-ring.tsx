import type { PropsWithChildren } from 'react'
import { View } from 'react-native'

import { useTheme } from '../design-system'

type FocusRingProps = PropsWithChildren<{
  focused: boolean
  radius: number
  testID?: string
}>

export function FocusRing({ children, focused, radius, testID }: FocusRingProps) {
  const { colors } = useTheme()

  return (
    <View
      testID={testID}
      style={{
        borderColor: focused ? colors.focus : 'transparent',
        borderRadius: radius + 4,
        borderWidth: 2,
        padding: 2,
      }}
    >
      {children}
    </View>
  )
}
