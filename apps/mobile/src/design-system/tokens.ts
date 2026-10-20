import { tokenSource } from './source'

export type ThemeMode = (typeof tokenSource.color.themes)[number]['id'] & ('light' | 'dark')
export type TokenFamily = keyof typeof tokenSource.type.families

type CamelCaseTokenName<Name extends string> = Name extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<CamelCaseTokenName<Tail>>}`
  : Name

type SourceColorToken = (typeof tokenSource.color.tokens)[number]
type SourceEasingToken = (typeof tokenSource.easing.tokens)[number]

export type ColorTokens = {
  [Token in SourceColorToken as CamelCaseTokenName<Token['name']>]: string
}

type NumericTokenMap<Tokens extends readonly { name: string; value: string }[]> = {
  [Token in Tokens[number] as CamelCaseTokenName<Token['name']>]: number
}

export type SpacingTokens = NumericTokenMap<typeof tokenSource.spacing.tokens>
export type RadiusTokens = NumericTokenMap<typeof tokenSource.radius.tokens>
export type DurationTokens = NumericTokenMap<typeof tokenSource.duration.tokens>

type StringTokenMap<Tokens extends readonly { name: string; value: string }[]> = {
  [Token in Tokens[number] as CamelCaseTokenName<Token['name']>]: Token['value']
}

export type BezierToken = readonly [number, number, number, number]
export type EasingTokens = {
  [Token in SourceEasingToken as CamelCaseTokenName<Token['name']>]: BezierToken
}
export type ShadowTokens = StringTokenMap<typeof tokenSource.shadow.tokens>

export function toNativeTokenKey(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, character: string) => character.toUpperCase())
}

export function createColorTokens(mode: ThemeMode): ColorTokens {
  return Object.fromEntries(
    tokenSource.color.tokens.map(({ name, value }) => [toNativeTokenKey(name), value[mode]]),
  ) as ColorTokens
}

export function parseNumericToken(value: string, unit: 'px' | 'ms'): number {
  const pattern = new RegExp(`^(-?\\d+(?:\\.\\d+)?)${unit}$`)
  const match = pattern.exec(value.trim())

  if (!match) {
    throw new Error(`Valor de token incompatível com ${unit}: ${value}`)
  }

  return Number(match[1])
}

export function createNumericTokenMap<Tokens extends readonly { name: string; value: string }[]>(
  tokens: Tokens,
  unit: 'px' | 'ms',
): NumericTokenMap<Tokens> {
  return Object.fromEntries(
    tokens.map(({ name, value }) => [toNativeTokenKey(name), parseNumericToken(value, unit)]),
  ) as NumericTokenMap<Tokens>
}

export const spacingTokens = createNumericTokenMap(tokenSource.spacing.tokens, 'px')
export const radiusTokens = createNumericTokenMap(tokenSource.radius.tokens, 'px')
export const durationTokens = createNumericTokenMap(tokenSource.duration.tokens, 'ms')

export function parseCubicBezierToken(value: string): BezierToken {
  const match =
    /^cubic-bezier\(\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*(-?(?:\d+\.?\d*|\.\d+))\s*\)$/.exec(
      value.trim(),
    )

  if (!match) {
    throw new Error(`Valor de easing incompatível com cubic-bezier: ${value}`)
  }

  const [x1, y1, x2, y2] = match.slice(1).map(Number)
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw new Error(`Coordenada x fora do intervalo de cubic-bezier: ${value}`)
  }

  return [x1, y1, x2, y2]
}

export const easingTokens = Object.fromEntries(
  tokenSource.easing.tokens.map(({ name, value }) => [
    toNativeTokenKey(name),
    parseCubicBezierToken(value),
  ]),
) as EasingTokens

export const shadowTokens = Object.fromEntries(
  tokenSource.shadow.tokens.map(({ name, value }) => [toNativeTokenKey(name), value]),
) as ShadowTokens
