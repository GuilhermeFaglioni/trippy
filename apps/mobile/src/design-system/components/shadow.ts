import { Platform, type ViewStyle } from 'react-native'

import type { ShadowTokens } from '../tokens'

/** Converte o valor CSS do token (`0 8px 20px rgba(r,g,b,a)`) em estilo de sombra nativo. */
export function toNativeShadow(value: ShadowTokens[keyof ShadowTokens]): ViewStyle {
  const match =
    /^(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px\s+rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(
      value.replace(/^0\s/, '0px ').trim(),
    )

  if (!match) {
    throw new Error(`Sombra de token incompatível: ${value}`)
  }

  const [offsetX, offsetY, blur, red, green, blue, alpha] = match.slice(1).map(Number)

  return {
    shadowColor: `rgb(${red}, ${green}, ${blue})`,
    shadowOffset: { width: offsetX, height: offsetY },
    shadowOpacity: alpha,
    shadowRadius: blur / 2,
    ...(Platform.OS === 'android' ? { elevation: 8 } : {}),
  }
}
