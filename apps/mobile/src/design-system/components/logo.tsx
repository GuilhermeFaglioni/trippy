import { View } from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'

import { useTheme } from '../theme-provider'
import { Text } from './text'

export type TrippyLogoProps = {
  /** `lg`: login (símbolo de 56px, texto de 28px). `sm`: cabeçalho das telas (32px, 24px). */
  size?: 'lg' | 'sm'
  /** `onForest`: símbolo claro sobre fundo forest (login). */
  onForest?: boolean
  testID?: string
}

/** Símbolo (viewBox 96 × 96 do HTML de referência) + "trippy" em Bricolage 800. */
export function TrippyLogo({ size = 'sm', onForest = false, testID }: TrippyLogoProps) {
  const { colors, mode } = useTheme()
  const large = size === 'lg'
  const symbol = large ? 56 : 32
  const body = onForest ? colors.onForest : colors.forest
  const pin = onForest ? colors.forest : colors.onForest
  const wordColor = onForest ? colors.onForest : mode === 'dark' ? colors.onForest : colors.forest

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Trippy"
      style={{ alignItems: 'center', flexDirection: 'row', gap: large ? 14 : 8 }}
    >
      <Svg width={symbol} height={symbol} viewBox="0 0 96 96">
        <Rect width={96} height={96} rx={24} fill={body} />
        <Path d="M48 80s-20-17-20-36a20 20 0 0 1 40 0c0 19-20 36-20 36z" fill={pin} />
        <Circle cx={48} cy={44} r={9} fill={colors.mustard} />
        <Rect x={58} y={16} width={22} height={10} rx={5} fill={colors.terracotta} />
      </Svg>
      <Text
        variant="titleM"
        color={wordColor}
        style={{
          fontSize: large ? 28 : 24,
          fontWeight: '800',
          letterSpacing: large ? -0.5 : 0,
          lineHeight: large ? 32 : 28,
        }}
      >
        trippy
      </Text>
    </View>
  )
}
