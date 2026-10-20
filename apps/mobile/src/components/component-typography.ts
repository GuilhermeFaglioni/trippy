import { Platform, type TextStyle } from 'react-native'

import { createTypographyTokens, normalizeFontPlatform } from '../design-system'

const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

export function getTypography(token: keyof typeof typography): TextStyle {
  return typography[token]
}
