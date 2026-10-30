import { View } from 'react-native'

export type DecorTileProps = {
  color: string
  width: number
  height: number
  radius: number
  /** Graus; negativo gira para a esquerda. */
  rotate?: number
  offsetY?: number
}

/** Cartão colorido inclinado das telas de abertura (login, home sem viagens). Só decoração. */
export function DecorTile({
  color,
  width,
  height,
  radius,
  rotate = 0,
  offsetY = 0,
}: DecorTileProps) {
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        backgroundColor: color,
        borderRadius: radius,
        height,
        transform: [{ translateY: offsetY }, { rotate: `${rotate}deg` }],
        width,
      }}
    />
  )
}
