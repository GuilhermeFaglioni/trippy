import { useState } from 'react'
import { Text, TextInput, View, type TextInputProps } from 'react-native'

import { TEXT_SCALING_PROPS, useTheme } from '../design-system'
import { getTypography } from './component-typography'
import { FocusRing } from './focus-ring'

export type TextFieldProps = Omit<
  TextInputProps,
  | 'accessibilityHint'
  | 'accessibilityLabel'
  | 'accessibilityState'
  | 'allowFontScaling'
  | 'editable'
  | 'maxFontSizeMultiplier'
  | 'onChangeText'
  | 'style'
  | 'testID'
  | 'value'
> & {
  label: string
  value: string
  onChangeText: (value: string) => void
  error?: string
  disabled?: boolean
  accessibilityHint?: string
  testID?: string
}

export function TextField({
  label,
  value,
  onChangeText,
  error,
  disabled = false,
  accessibilityHint,
  placeholder,
  onFocus,
  onBlur,
  multiline = false,
  testID,
  ...inputProps
}: TextFieldProps) {
  const theme = useTheme()
  const [focused, setFocused] = useState(false)
  const hasError = error !== undefined && error.length > 0
  const inputRadius = theme.radius.radiusSm
  const inputBorderColor = disabled
    ? 'transparent'
    : hasError
      ? theme.colors.danger
      : focused
        ? theme.colors.forest
        : theme.colors.lineStrong
  const inputHint = [accessibilityHint, hasError ? `Erro: ${error}` : undefined]
    .filter(Boolean)
    .join('. ')

  return (
    <View style={{ gap: theme.spacing.space1 }}>
      <Text
        {...TEXT_SCALING_PROPS}
        style={[getTypography('bodyStrong'), { color: theme.colors.ink }]}
      >
        {label}
      </Text>
      <FocusRing
        focused={focused && !disabled}
        radius={inputRadius}
        testID={testID ? `${testID}-focus-ring` : undefined}
      >
        <TextInput
          {...inputProps}
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          onFocus={(event) => {
            setFocused(true)
            onFocus?.(event)
          }}
          onBlur={(event) => {
            setFocused(false)
            onBlur?.(event)
          }}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.inkMuted}
          selectionColor={theme.colors.forest}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          editable={!disabled}
          accessibilityLabel={label}
          accessibilityHint={inputHint || undefined}
          accessibilityState={{ disabled }}
          allowFontScaling={TEXT_SCALING_PROPS.allowFontScaling}
          maxFontSizeMultiplier={TEXT_SCALING_PROPS.maxFontSizeMultiplier}
          style={[
            getTypography('body'),
            {
              backgroundColor: disabled ? theme.colors.sand : theme.colors.surface,
              borderColor: inputBorderColor,
              borderRadius: inputRadius,
              borderWidth: disabled ? 0 : focused || hasError ? 2 : 1,
              color: disabled ? theme.colors.inkMuted : theme.colors.ink,
              minHeight: theme.spacing.targetMin,
              minWidth: theme.spacing.targetMin,
              paddingHorizontal: theme.spacing.space3,
              paddingVertical: theme.spacing.space2,
            },
          ]}
        />
      </FocusRing>
      {hasError ? (
        <Text
          accessibilityLiveRegion="polite"
          {...TEXT_SCALING_PROPS}
          style={[getTypography('bodySm'), { color: theme.colors.danger }]}
        >
          {error}
        </Text>
      ) : null}
    </View>
  )
}
