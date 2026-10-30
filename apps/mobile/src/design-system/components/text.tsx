import { Platform, type TextStyle } from 'react-native'

import { TypographyText, type TypographyTextProps } from '../typography-text'
import { createTypographyTokens, normalizeFontPlatform, type TypographyTokens } from '../typography'

const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

function sans(
  fontSize: number,
  fontWeight: TextStyle['fontWeight'],
  lineHeight: number,
  extra: TextStyle = {},
): TextStyle {
  return { ...typography.body, fontSize, fontWeight, lineHeight, ...extra }
}

/** Estilos de texto dos componentes (`bundle.css`) que não são um token de tipografia. */
const componentTextStyles = {
  eyebrow: sans(12, '700', 16, { letterSpacing: 0.8, textTransform: 'uppercase' }),
  button: sans(16, '700', 20),
  buttonSecondary: sans(15, '700', 18),
  chip: sans(12, '700', 16),
  filter: sans(13, '500', 18),
  filterSelected: sans(13, '700', 18),
  avatar: sans(14, '700', 18),
  avatarSm: sans(12, '700', 16),
  notice: sans(13, '400', 18),
  fieldLabel: sans(14, '700', 18),
  fieldInput: sans(16, '500', 20),
  fieldHelp: sans(13, '400', 18),
  placeName: sans(15, '700', 20),
  placeAddress: sans(13, '400', 18),
  tab: sans(11, '500', 14),
  tabCurrent: sans(11, '700', 14),
  backLink: sans(14, '400', 20),
  count: sans(13, '700', 16),
} as const satisfies Record<string, TextStyle>

export const textStyles = { ...typography, ...componentTextStyles } as TypographyTokens &
  typeof componentTextStyles

export type TextVariant = keyof typeof textStyles

const displayVariants: readonly TextVariant[] = ['hero', 'titleL', 'titleM', 'titleS']
const localVariants: readonly TextVariant[] = ['cardName', 'cardAddress']

export type TextProps = Omit<TypographyTextProps, 'family' | 'style'> & {
  variant: TextVariant
  color: string
  style?: TextStyle
}

export function Text({ variant, color, style, ...rest }: TextProps) {
  const family = displayVariants.includes(variant)
    ? 'display'
    : localVariants.includes(variant)
      ? 'local'
      : 'sans'

  return (
    <TypographyText {...rest} family={family} style={[textStyles[variant], { color }, style]} />
  )
}
