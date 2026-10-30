const PRESSED_DARKENING = 0.08

/** Escurece 8% cada canal RGB do token usado no estado pressionado. */
export function derivePressedColor(tokenColor: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(tokenColor)

  if (!match) {
    throw new Error(`Cor do token precisa estar no formato #RRGGBB: ${tokenColor}`)
  }

  const channels = [0, 2, 4].map((index) => {
    const channel = Number.parseInt(match[1].slice(index, index + 2), 16)
    return Math.round(channel * (1 - PRESSED_DARKENING))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
  })

  return `#${channels.join('')}`
}

/** `#RRGGBB` do token com opacidade, para texto e bordas discretos sobre o card forest. */
export function withAlpha(tokenColor: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(tokenColor)

  if (!match) {
    throw new Error(`Cor do token precisa estar no formato #RRGGBB: ${tokenColor}`)
  }

  const [red, green, blue] = [0, 2, 4].map((index) =>
    Number.parseInt(match[1].slice(index, index + 2), 16),
  )

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}
