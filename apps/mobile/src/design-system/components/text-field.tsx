import { useState } from 'react'
import { Platform, TextInput, View, type TextInputProps } from 'react-native'

import { useTheme } from '../theme-provider'
import { getTextInputFontFamily, normalizeFontPlatform, TEXT_SCALING_PROPS } from '../typography'
import { FocusRing } from './focus-ring'
import { Icon, type IconName } from './icon'
import { Text, textStyles } from './text'

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
  /** Mensagem dizendo o que corrigir; ativa o estado de erro. */
  error?: string
  /** Ajuda abaixo do campo (some enquanto houver erro). */
  help?: string
  /** Marca o rótulo com "(opcional)". */
  optional?: boolean
  /** Ícone de 18px à esquerda do texto (busca). */
  leadingIcon?: IconName
  /** Altura mínima do campo; padrão 52 (campo de várias linhas pode pedir mais). */
  minHeight?: number
  disabled?: boolean
  locale?: string
  testID?: string
}

export function TextField({
  label,
  value,
  onChangeText,
  error,
  help,
  optional = false,
  leadingIcon,
  minHeight = 52,
  disabled = false,
  locale,
  placeholder,
  onFocus,
  onBlur,
  multiline = false,
  testID,
  ...inputProps
}: TextFieldProps) {
  const { colors, radius, spacing } = useTheme()
  const [focused, setFocused] = useState(false)
  const hasError = error !== undefined && error.length > 0
  const message = hasError ? error : help
  const emphasized = !disabled && (focused || hasError)
  const borderWidth = emphasized ? 2 : 1
  const borderColor = disabled
    ? 'transparent'
    : hasError
      ? colors.danger
      : focused
        ? colors.forest
        : colors.lineStrong

  return (
    <View style={{ gap: 6, minWidth: 0 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Text variant="fieldLabel" color={colors.ink} locale={locale}>
          {label}
        </Text>
        {optional ? (
          <Text
            variant="fieldLabel"
            color={colors.inkMuted}
            locale={locale}
            style={{ fontWeight: '500' }}
          >
            {' (opcional)'}
          </Text>
        ) : null}
      </View>
      <View>
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
          placeholderTextColor={colors.inkMuted}
          selectionColor={colors.forest}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          editable={!disabled}
          accessibilityLabel={label}
          accessibilityHint={message}
          accessibilityState={{ disabled }}
          allowFontScaling={TEXT_SCALING_PROPS.allowFontScaling}
          maxFontSizeMultiplier={TEXT_SCALING_PROPS.maxFontSizeMultiplier}
          style={[
            textStyles.fieldInput,
            {
              backgroundColor: disabled ? colors.sand : colors.surface,
              borderColor,
              borderRadius: radius.radiusSm,
              borderWidth,
              color: disabled ? colors.inkMuted : colors.ink,
              fontFamily: getTextInputFontFamily(
                value || placeholder || '',
                'sans',
                normalizeFontPlatform(Platform.OS),
                locale,
              ),
              minHeight,
              // A borda de 2px não empurra o texto: o padding compensa.
              paddingHorizontal: spacing.space4 + 1 - borderWidth,
              ...(leadingIcon ? { paddingLeft: spacing.space4 + 1 - borderWidth + 28 } : {}),
              paddingVertical: multiline ? spacing.space3 : 0,
              width: '100%',
            },
          ]}
        />
        {leadingIcon ? (
          <View
            pointerEvents="none"
            style={{
              alignItems: 'center',
              bottom: 0,
              justifyContent: 'center',
              left: spacing.space4 - 1,
              position: 'absolute',
              top: 0,
            }}
          >
            <Icon name={leadingIcon} color={colors.inkMuted} size={18} />
          </View>
        ) : null}
        {focused && !disabled ? (
          <FocusRing
            radius={radius.radiusSm}
            testID={testID ? `${testID}-focus-ring` : undefined}
          />
        ) : null}
      </View>
      {message ? (
        <Text
          variant="fieldHelp"
          color={hasError ? colors.danger : colors.inkMuted}
          locale={locale}
          accessibilityLiveRegion={hasError ? 'polite' : 'none'}
        >
          {message}
        </Text>
      ) : null}
    </View>
  )
}
