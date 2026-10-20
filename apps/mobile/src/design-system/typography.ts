import type { TextStyle } from 'react-native'

import { tokenSource } from './source'
import { parseNumericToken, toNativeTokenKey, type TokenFamily } from './tokens'

export type FontPlatform = 'ios' | 'android' | 'web'

type SourceTypographyStyle = (typeof tokenSource.type.groups)[number]['styles'][number]
type TypographyTokenName = SourceTypographyStyle['name']
type NativeTypographyTokenName = TypographyTokenName extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<Tail>}`
  : TypographyTokenName

export type TypographyTokens = Record<NativeTypographyTokenName, TextStyle>

const FONT_STACKS = tokenSource.type.families

function getFontStack(family: TokenFamily): string[] {
  return FONT_STACKS[family]
    .split(',')
    .map((name) => name.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

export function getFontFamilyTokenName(family: Exclude<TokenFamily, 'local'>): string {
  return getFontStack(family)[0]
}

export function getFontFamilyForPlatform(
  family: TokenFamily,
  platform: FontPlatform,
): string | undefined {
  if (family !== 'local') {
    return getFontFamilyTokenName(family)
  }

  if (platform === 'ios') {
    return undefined
  }

  const fallbackNames = getFontStack(family)
  const platformFallback = platform === 'android' ? 'sans-serif' : 'system-ui'

  return fallbackNames.find((name) => name === platformFallback)
}

export function createTypographyTokens(platform: FontPlatform): TypographyTokens {
  const styles = tokenSource.type.groups.flatMap((group) =>
    group.styles.map((sourceStyle) => {
      const letterSpacing = 'letterSpacing' in sourceStyle ? sourceStyle.letterSpacing : undefined
      const textTransform = 'textTransform' in sourceStyle ? sourceStyle.textTransform : undefined
      const style: TextStyle = {
        fontFamily: getFontFamilyForPlatform(group.family as TokenFamily, platform),
        fontSize: parseNumericToken(sourceStyle.fontSize, 'px'),
        lineHeight: parseNumericToken(sourceStyle.lineHeight, 'px'),
        fontWeight: String(sourceStyle.fontWeight) as TextStyle['fontWeight'],
        ...(letterSpacing === undefined
          ? {}
          : { letterSpacing: parseNumericToken(letterSpacing, 'px') }),
        ...(textTransform === undefined
          ? {}
          : { textTransform: textTransform as TextStyle['textTransform'] }),
      }

      return [toNativeTokenKey(sourceStyle.name), style] as const
    }),
  )

  return Object.fromEntries(styles) as TypographyTokens
}

export const TEXT_SCALING_PROPS = {
  allowFontScaling: true,
  maxFontSizeMultiplier: 2,
} as const
