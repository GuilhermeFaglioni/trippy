import type { TextStyle } from 'react-native'

import { tokenSource } from './source'
import { parseNumericToken, toNativeTokenKey, type TokenFamily } from './tokens'

export type FontPlatform = 'ios' | 'android' | 'web'
export type CjkLocale = 'zh' | 'ja' | 'ko'
export type TypographyFontRun = { text: string; fontFamily: string }

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

function getLocaleRegion(locale?: string): CjkLocale | undefined {
  const language = locale?.trim().toLowerCase().split(/[-_]/)[0]

  if (language === 'zh' || language === 'ja' || language === 'ko') {
    return language
  }

  return undefined
}

function familyForRegion(region: CjkLocale): string {
  const suffix = { zh: 'SC', ja: 'JP', ko: 'KR' }[region]
  const family = getFontStack('local').find((name) => name === `Noto Sans ${suffix}`)

  // Primeira família local declarada no token: padrão para texto Han sem locale.
  return family ?? getFontStack('local')[0]
}

function codePointOf(character: string): number {
  return character.codePointAt(0) ?? 0
}

function isHangul(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x3130 && codePoint <= 0x318f) ||
    (codePoint >= 0xa960 && codePoint <= 0xa97f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xd7b0 && codePoint <= 0xd7ff)
  )
}

function isKana(codePoint: number): boolean {
  return (
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0x31f0 && codePoint <= 0x31ff) ||
    (codePoint >= 0xff65 && codePoint <= 0xff9f)
  )
}

function isHan(codePoint: number): boolean {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x20000 && codePoint <= 0x323af)
  )
}

function isCjkPunctuation(codePoint: number): boolean {
  return (
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0xff01 && codePoint <= 0xff0f) ||
    (codePoint >= 0xff1a && codePoint <= 0xff20) ||
    (codePoint >= 0xff3b && codePoint <= 0xff40) ||
    (codePoint >= 0xff5b && codePoint <= 0xff65)
  )
}

function inferRegionFromText(text: string): CjkLocale | undefined {
  for (const character of Array.from(text)) {
    const codePoint = codePointOf(character)

    if (isKana(codePoint)) return 'ja'
    if (isHangul(codePoint)) return 'ko'
  }

  return undefined
}

function getTextRegion(text: string, locale?: string): CjkLocale {
  return getLocaleRegion(locale) ?? inferRegionFromText(text) ?? 'zh'
}

function getCjkFamily(character: string, preferredRegion: CjkLocale): string | undefined {
  const codePoint = codePointOf(character)

  if (isHangul(codePoint)) return familyForRegion('ko')
  if (isKana(codePoint)) return familyForRegion('ja')
  if (isHan(codePoint) || isCjkPunctuation(codePoint)) return familyForRegion(preferredRegion)

  return undefined
}

export function getFontFamilyTokenName(family: Exclude<TokenFamily, 'local'>): string {
  return getFontStack(family)[0]
}

export function normalizeFontPlatform(platform: string): FontPlatform {
  return platform === 'android' ? 'android' : platform === 'web' ? 'web' : 'ios'
}

export function getFontFamilyForPlatform(
  family: TokenFamily,
  _platform: FontPlatform,
  locale?: string,
): string {
  if (family !== 'local') {
    return getFontFamilyTokenName(family)
  }

  return familyForRegion(getTextRegion('', locale))
}

export function getTypographyFontRuns(
  text: string,
  family: TokenFamily,
  platform: FontPlatform,
  locale?: string,
): TypographyFontRun[] {
  if (family === 'local') {
    return [
      { text, fontFamily: getFontFamilyForPlatform(family, platform, getTextRegion(text, locale)) },
    ]
  }

  const primaryFamily = getFontFamilyForPlatform(family, platform)
  const preferredRegion = getTextRegion(text, locale)
  const runs: TypographyFontRun[] = []

  for (const character of Array.from(text)) {
    const fontFamily = getCjkFamily(character, preferredRegion) ?? primaryFamily
    const previousRun = runs[runs.length - 1]

    if (previousRun?.fontFamily === fontFamily) {
      previousRun.text += character
    } else {
      runs.push({ text: character, fontFamily })
    }
  }

  return runs
}

export function getTextInputFontFamily(
  text: string,
  family: TokenFamily,
  platform: FontPlatform,
  locale?: string,
): string {
  const primaryFamily = getFontFamilyForPlatform(family, platform, locale)
  const preferredRegion = getTextRegion(text, locale)

  for (const character of Array.from(text)) {
    const cjkFamily = getCjkFamily(character, preferredRegion)
    if (cjkFamily) return cjkFamily
  }

  return primaryFamily
}

export function createTypographyTokens(platform: FontPlatform, locale?: string): TypographyTokens {
  const styles = tokenSource.type.groups.flatMap((group) =>
    group.styles.map((sourceStyle) => {
      const letterSpacing = 'letterSpacing' in sourceStyle ? sourceStyle.letterSpacing : undefined
      const textTransform = 'textTransform' in sourceStyle ? sourceStyle.textTransform : undefined
      const style: TextStyle = {
        fontFamily: getFontFamilyForPlatform(group.family as TokenFamily, platform, locale),
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
