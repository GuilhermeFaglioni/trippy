import { View } from 'react-native'

import { useTheme } from '../theme-provider'

/** Anel de foco de 2px com 2px de afastamento, desenhado por cima sem mexer no layout. */
export function FocusRing({ radius, testID }: { radius: number; testID?: string }) {
  const { colors } = useTheme()

  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: -4,
        right: -4,
        bottom: -4,
        left: -4,
        borderColor: colors.focus,
        borderRadius: radius + 4,
        borderWidth: 2,
      }}
    />
  )
}
