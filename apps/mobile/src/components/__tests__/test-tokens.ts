import tokenSource from '../../../../../docs/design-system/tokens.json'

type ColorTokenName = (typeof tokenSource.color.tokens)[number]['name']

export function colorToken(name: ColorTokenName, mode: 'light' | 'dark' = 'light'): string {
  const token = tokenSource.color.tokens.find((candidate) => candidate.name === name)

  if (!token) {
    throw new Error(`Token de cor ausente: ${name}`)
  }

  return token.value[mode]
}

export function numericToken(name: string): number {
  const token = [...tokenSource.spacing.tokens, ...tokenSource.radius.tokens].find(
    (candidate) => candidate.name === name,
  )

  if (!token) {
    throw new Error(`Token numérico ausente: ${name}`)
  }

  return Number.parseFloat(token.value)
}
