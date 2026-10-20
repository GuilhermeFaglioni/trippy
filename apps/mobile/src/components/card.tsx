import { useState, type PropsWithChildren } from 'react'
import { Pressable, View } from 'react-native'

import { useTheme } from '../design-system'
import { FocusRing } from './focus-ring'

export type CardVariant = 'default' | 'highlight'

/**
 * Card is a generic container and does not style descendant text. For `highlight`,
 * consumers must style text children with `useTheme().colors.onForest`.
 */
export type CardProps = PropsWithChildren<{
  variant?: CardVariant
  onPress?: () => void
  accessibilityLabel?: string
  accessibilityHint?: string
  testID?: string
}>

export function Card({
  children,
  variant = 'default',
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: CardProps) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  const isInteractive = onPress !== undefined
  const surfaceStyle = {
    backgroundColor: variant === 'highlight' ? theme.colors.forest : theme.colors.surface,
    borderColor: variant === 'highlight' ? 'transparent' : theme.colors.line,
    borderRadius: variant === 'highlight' ? theme.radius.radiusLg : theme.radius.radiusMd,
    borderWidth: variant === 'highlight' ? 0 : 1,
    padding: theme.spacing.space4,
    ...(isInteractive
      ? {
          minHeight: theme.spacing.targetMin,
          minWidth: theme.spacing.targetMin,
        }
      : {}),
  } as const

  if (!isInteractive) {
    return (
      <View testID={testID} style={surfaceStyle}>
        {children}
      </View>
    )
  }

  const cardRadius = variant === 'highlight' ? theme.radius.radiusLg : theme.radius.radiusMd

  return (
    <FocusRing
      focused={focused}
      radius={cardRadius}
      testID={testID ? `${testID}-focus-ring` : undefined}
    >
      <Pressable
        testID={testID}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        onPress={onPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={surfaceStyle}
      >
        {children}
      </Pressable>
    </FocusRing>
  )
}
