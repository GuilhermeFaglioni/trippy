import { Platform, Text, type TextProps } from 'react-native'

import {
  TEXT_SCALING_PROPS,
  getFontFamilyForPlatform,
  getTypographyFontRuns,
  normalizeFontPlatform,
} from './typography'
import type { TokenFamily } from './tokens'

export type TypographyTextProps = Omit<
  TextProps,
  'children' | 'allowFontScaling' | 'maxFontSizeMultiplier'
> & {
  children: string
  family: TokenFamily
  locale?: string
}

export function TypographyText({
  family,
  locale,
  children,
  style,
  ...textProps
}: TypographyTextProps) {
  const platform = normalizeFontPlatform(Platform.OS)
  const runs = getTypographyFontRuns(children, family, platform, locale)
  const primaryFont = getFontFamilyForPlatform(family, platform, locale)
  const hasMultipleFonts = runs.some((run) => run.fontFamily !== primaryFont)

  return (
    <Text {...textProps} {...TEXT_SCALING_PROPS} style={[style, { fontFamily: primaryFont }]}>
      {hasMultipleFonts
        ? runs.map((run, index) => (
            <Text key={`${run.fontFamily}-${index}`} style={{ fontFamily: run.fontFamily }}>
              {run.text}
            </Text>
          ))
        : children}
    </Text>
  )
}
