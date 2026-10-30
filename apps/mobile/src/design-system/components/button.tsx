import { useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'

import { useTheme } from '../theme-provider'
import { derivePressedColor } from './color'
import { FocusRing } from './focus-ring'
import { Icon, type IconName } from './icon'
import { toNativeShadow } from './shadow'
import { Text } from './text'

/** `inverse`: botão claro (`on-forest`, texto escuro) sobre o card de destaque nos dois temas. */
export type ButtonVariant = 'primary' | 'secondary' | 'fab' | 'inverse'

export type ButtonProps = {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  /** Ícone Lucide de 18–20px antes do rótulo. */
  icon?: IconName
  /** Secundário alternável (`aria-pressed`): marcado vira forest. */
  pressed?: boolean
  disabled?: boolean
  loading?: boolean
  /** Largura total. Padrão: só o principal. */
  block?: boolean
  accessibilityLabel?: string
  accessibilityHint?: string
  locale?: string
  testID?: string
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  pressed,
  disabled = false,
  loading = false,
  block = variant === 'primary' || variant === 'inverse',
  accessibilityLabel,
  accessibilityHint,
  locale,
  testID,
}: ButtonProps) {
  const { colors, radius, spacing, shadow } = useTheme()
  const [focused, setFocused] = useState(false)
  const isDisabled = disabled || loading
  const isToggle = variant === 'secondary' && pressed !== undefined
  const isMarked = isToggle && pressed === true
  const borderRadius =
    variant === 'secondary' || variant === 'inverse' ? radius.radiusSm : radius.radiusMd

  const foreground = disabled
    ? colors.inkMuted
    : variant === 'secondary'
      ? isMarked
        ? colors.onForest
        : colors.ink
      : variant === 'inverse'
        ? colors.onMustard
        : colors.onTerracotta

  return (
    <View style={{ alignSelf: block ? 'stretch' : 'flex-start' }}>
      <Pressable
        testID={testID}
        accessible
        accessibilityRole={isToggle ? 'togglebutton' : 'button'}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{
          disabled: isDisabled,
          busy: loading,
          ...(isToggle ? { checked: isMarked } : {}),
        }}
        disabled={isDisabled}
        onPress={onPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed: touching }) => {
          const terracotta = touching ? derivePressedColor(colors.terracotta) : colors.terracotta
          const backgroundColor = disabled
            ? colors.sand
            : variant === 'secondary'
              ? isMarked
                ? colors.forest
                : touching
                  ? colors.sand
                  : colors.surface
              : variant === 'inverse'
                ? touching
                  ? derivePressedColor(colors.onForest)
                  : colors.onForest
                : terracotta
          const bordered = variant === 'secondary' && !disabled

          return {
            alignItems: 'center',
            backgroundColor,
            borderColor: isMarked ? colors.forest : colors.lineStrong,
            borderRadius,
            borderWidth: bordered ? 1 : 0,
            justifyContent: 'center',
            minHeight:
              variant === 'secondary' ? spacing.targetMin : variant === 'inverse' ? 48 : 56,
            paddingHorizontal: spacing.space5,
            paddingVertical: spacing.space2,
            ...(variant === 'fab' && !disabled ? toNativeShadow(shadow.shadowFab) : {}),
          }
        }}
      >
        <View
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            gap: spacing.space2,
            justifyContent: 'center',
            opacity: loading ? 0 : 1,
          }}
        >
          {icon ? <Icon name={icon} color={foreground} size={20} /> : null}
          <Text
            variant={
              variant === 'secondary' || variant === 'inverse' ? 'buttonSecondary' : 'button'
            }
            color={foreground}
            locale={locale}
            style={{ flexShrink: 1, textAlign: 'center' }}
          >
            {label}
          </Text>
        </View>
        {loading ? (
          <ActivityIndicator
            testID={testID ? `${testID}-loading-indicator` : undefined}
            accessible={false}
            color={foreground}
            size="small"
            style={{ position: 'absolute' }}
          />
        ) : null}
      </Pressable>
      {focused && !isDisabled ? (
        <FocusRing radius={borderRadius} testID={testID ? `${testID}-focus-ring` : undefined} />
      ) : null}
    </View>
  )
}
