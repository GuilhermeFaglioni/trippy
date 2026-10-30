import type { PropsWithChildren } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'

import { useTheme } from '../theme-provider'
import { Text } from './text'

type CardProps = PropsWithChildren<{ style?: StyleProp<ViewStyle>; testID?: string }>

/** Superfície plana de conteúdo. Sem altura fixa: o conteúdo manda. */
export function Card({ children, style, testID }: CardProps) {
  const { colors, radius, spacing } = useTheme()

  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.radiusMd,
          gap: spacing.space3,
          padding: spacing.space4,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

/** Card de destaque (forest): no máximo um por tela. */
export function HighlightCard({ children, style, testID }: CardProps) {
  const { colors, radius, spacing } = useTheme()

  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: colors.forest,
          borderRadius: radius.radiusLg,
          gap: spacing.space3,
          padding: 18,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

/** Rótulo de seção em caixa-alta; `onHighlight` usa mostarda sobre o card de destaque. */
export function Eyebrow({
  children,
  onHighlight = false,
}: {
  children: string
  onHighlight?: boolean
}) {
  const { colors } = useTheme()

  return (
    <Text
      variant="eyebrow"
      color={onHighlight ? colors.mustard : colors.inkMuted}
      accessibilityRole="header"
    >
      {children}
    </Text>
  )
}
