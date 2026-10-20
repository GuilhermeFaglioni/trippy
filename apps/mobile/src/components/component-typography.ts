import { Platform, type TextStyle } from 'react-native'

import { createTypographyTokens, type FontPlatform } from '../design-system'

const fontPlatform: FontPlatform =
  Platform.OS === 'android' ? 'android' : Platform.OS === 'web' ? 'web' : 'ios'

const typography = createTypographyTokens(fontPlatform)

export function getTypography(token: keyof typeof typography): TextStyle {
  return typography[token]
}
