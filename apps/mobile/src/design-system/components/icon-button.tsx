import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { useTheme } from '../theme-provider'
import { FocusRing } from './focus-ring'
import { Icon, type IconName } from './icon'
import { Text } from './text'

export type IconButtonTone = 'default' | 'favorite'

export type IconButtonProps = {
  icon: IconName
  /** Obrigatório: o botão não tem texto visível. */
  accessibilityLabel: string
  onPress: () => void
  /** Alternável (`aria-pressed`): marcado preenche o ícone ou, no check, engrossa o traço. */
  pressed?: boolean
  /** `favorite` mantém o fundo e pinta a estrela de terracotta quando marcada. */
  tone?: IconButtonTone
  disabled?: boolean
  /** Contagem ao lado do ícone (quero ir): vira o botão de 52 × 52. */
  count?: number
  testID?: string
}

const FILLABLE: readonly IconName[] = ['star', 'heart']

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  pressed,
  tone = 'default',
  disabled = false,
  count,
  testID,
}: IconButtonProps) {
  const { colors, radius, spacing } = useTheme()
  const [focused, setFocused] = useState(false)
  const isToggle = pressed !== undefined
  const isMarked = pressed === true
  const hasCount = count !== undefined
  const size = hasCount ? 52 : spacing.targetMin

  const filledBackground = isMarked && tone === 'default'
  // "Quero ir" marcado é terracotta; os demais alternáveis, forest.
  const markedBackground = hasCount ? colors.terracotta : colors.forest
  const markedForeground = hasCount ? colors.onTerracotta : colors.onForest
  const foreground = disabled
    ? colors.inkMuted
    : filledBackground
      ? markedForeground
      : isMarked && tone === 'favorite'
        ? colors.terracottaText
        : colors.ink

  return (
    <View style={{ width: size, height: size }}>
      <Pressable
        testID={testID}
        accessible
        accessibilityRole={isToggle ? 'togglebutton' : 'button'}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled, ...(isToggle ? { checked: isMarked } : {}) }}
        disabled={disabled}
        onPress={onPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed: touching }) => ({
          alignItems: 'center',
          backgroundColor: disabled
            ? colors.sand
            : filledBackground
              ? markedBackground
              : touching
                ? colors.sand
                : colors.surface,
          borderColor: filledBackground ? 'transparent' : colors.lineStrong,
          borderRadius: radius.radiusSm,
          borderWidth: disabled || filledBackground ? 0 : 1,
          height: size,
          justifyContent: 'center',
          gap: 2,
          width: size,
        })}
      >
        <Icon
          name={icon}
          color={foreground}
          size={hasCount ? 16 : 20}
          strokeWidth={icon === 'check' && isMarked ? 2.8 : 2}
          filled={isMarked && FILLABLE.includes(icon)}
        />
        {hasCount ? (
          <Text variant="count" color={foreground}>
            {String(count)}
          </Text>
        ) : null}
      </Pressable>
      {focused && !disabled ? (
        <FocusRing radius={radius.radiusSm} testID={testID ? `${testID}-focus-ring` : undefined} />
      ) : null}
    </View>
  )
}
