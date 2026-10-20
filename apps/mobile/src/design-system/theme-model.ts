import { tokenSource } from './source'
import {
  createColorTokens,
  durationTokens,
  easingTokens,
  radiusTokens,
  shadowTokens,
  spacingTokens,
  type ColorTokens,
  type DurationTokens,
  type EasingTokens,
  type RadiusTokens,
  type ShadowTokens,
  type SpacingTokens,
  type ThemeMode,
} from './tokens'

export type DesignTheme = {
  mode: ThemeMode
  colors: ColorTokens
  spacing: SpacingTokens
  radius: RadiusTokens
  duration: DurationTokens
  easing: EasingTokens
  shadow: ShadowTokens
}

export function resolveThemeMode(systemMode: ThemeMode | null | undefined): ThemeMode {
  return systemMode === 'dark' ? 'dark' : 'light'
}

export function createDesignTheme(mode: ThemeMode): DesignTheme {
  return {
    mode,
    colors: createColorTokens(mode),
    spacing: spacingTokens,
    radius: radiusTokens,
    duration: durationTokens,
    easing: easingTokens,
    shadow: shadowTokens,
  }
}

export const themeModes = tokenSource.color.themes.map(({ id }) => id)
