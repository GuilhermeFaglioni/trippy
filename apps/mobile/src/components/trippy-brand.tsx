import { Platform, View } from 'react-native'

import {
  createTypographyTokens,
  normalizeFontPlatform,
  TypographyText,
  useTheme,
} from '../design-system'

const typography = createTypographyTokens(normalizeFontPlatform(Platform.OS))

type TrippySymbolProps = {
  size: number
  testID?: string
}

export function TrippySymbol({ size, testID }: TrippySymbolProps) {
  const theme = useTheme()
  const pinSize = size * 0.48
  const innerSunSize = size * 0.18

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Símbolo do Trippy"
      testID={testID}
      style={{
        width: size,
        height: size,
        overflow: 'hidden',
        borderRadius: theme.radius.radiusLg,
        backgroundColor: theme.colors.forest,
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: size * 0.42,
          left: size * 0.32,
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.18,
          borderRightWidth: size * 0.18,
          borderTopWidth: size * 0.3,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: theme.colors.sand,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.18,
          left: (size - pinSize) / 2,
          width: pinSize,
          height: pinSize,
          borderRadius: pinSize / 2,
          backgroundColor: theme.colors.sand,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.18 + (pinSize - innerSunSize) / 2,
          left: (size - innerSunSize) / 2,
          width: innerSunSize,
          height: innerSunSize,
          borderRadius: innerSunSize / 2,
          backgroundColor: theme.colors.mustard,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.16,
          right: size * 0.06,
          width: size * 0.32,
          height: size * 0.11,
          borderRadius: size,
          backgroundColor: theme.colors.terracotta,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  )
}

export function TrippyWordmark() {
  const theme = useTheme()

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Trippy"
      testID="trippy-wordmark"
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.space2 }}
    >
      <TrippySymbol size={32} />
      <TypographyText
        family="display"
        style={[
          typography.titleS,
          {
            color: theme.mode === 'dark' ? theme.colors.onForest : theme.colors.forest,
          },
        ]}
      >
        trippy
      </TypographyText>
    </View>
  )
}
