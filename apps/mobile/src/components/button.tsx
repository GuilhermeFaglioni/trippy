import { useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'

import { TEXT_SCALING_PROPS, useTheme } from '../design-system'
import { getTypography } from './component-typography'
import { derivePressedColor } from './button-colors'
import { FocusRing } from './focus-ring'

export type ButtonVariant = 'primary' | 'secondary'

export type ButtonProps = {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  selected?: boolean
  disabled?: boolean
  loading?: boolean
  accessibilityLabel?: string
  accessibilityHint?: string
  testID?: string
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  selected = false,
  disabled = false,
  loading = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  const isDisabled = disabled || loading
  const isSelected = variant === 'secondary' && selected
  const buttonRadius = variant === 'primary' ? theme.radius.radiusMd : theme.radius.radiusSm

  return (
    <FocusRing
      focused={focused && !isDisabled}
      radius={buttonRadius}
      testID={testID ? `${testID}-focus-ring` : undefined}
    >
      <Pressable
        testID={testID}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{
          disabled: isDisabled,
          busy: loading,
          ...(variant === 'secondary' ? { selected: isSelected } : {}),
        }}
        disabled={isDisabled}
        onPress={onPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed }) => {
          const backgroundColor = disabled
            ? theme.colors.sand
            : variant === 'primary'
              ? pressed
                ? derivePressedColor(theme.colors.terracotta)
                : theme.colors.terracotta
              : isSelected
                ? theme.colors.forest
                : pressed
                  ? theme.colors.sand
                  : theme.colors.surface

          return {
            alignItems: 'center',
            backgroundColor,
            borderColor: disabled
              ? 'transparent'
              : variant === 'secondary'
                ? theme.colors.lineStrong
                : 'transparent',
            borderRadius: buttonRadius,
            borderWidth: variant === 'secondary' && !disabled && !isSelected ? 1 : 0,
            justifyContent: 'center',
            minHeight: theme.spacing.targetMin,
            minWidth: theme.spacing.targetMin,
            paddingHorizontal: theme.spacing.space4,
            paddingVertical: theme.spacing.space2,
          }
        }}
      >
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <Text
            {...TEXT_SCALING_PROPS}
            style={[
              getTypography('bodyStrong'),
              {
                color: disabled
                  ? theme.colors.inkMuted
                  : variant === 'primary'
                    ? theme.colors.onTerracotta
                    : isSelected
                      ? theme.colors.onForest
                      : theme.colors.ink,
                opacity: loading ? 0 : 1,
                textAlign: 'center',
              },
            ]}
          >
            {label}
          </Text>
          {loading ? (
            <ActivityIndicator
              testID={testID ? `${testID}-loading-indicator` : undefined}
              accessible={false}
              color={
                disabled
                  ? theme.colors.inkMuted
                  : variant === 'primary'
                    ? theme.colors.onTerracotta
                    : isSelected
                      ? theme.colors.onForest
                      : theme.colors.ink
              }
              size="small"
              style={{ position: 'absolute' }}
            />
          ) : null}
        </View>
      </Pressable>
    </FocusRing>
  )
}
