import tokenSource from '../../../../../docs/design-system/tokens.json'
import {
  createColorTokens,
  createNumericTokenMap,
  easingTokens,
  parseCubicBezierToken,
  toNativeTokenKey,
} from '../tokens'

describe('adaptador de tokens do design system', () => {
  it.each(['light', 'dark'] as const)('preserva todos os valores oficiais da paleta %s', (mode) => {
    const expected = Object.fromEntries(
      tokenSource.color.tokens.map(({ name, value }) => [toNativeTokenKey(name), value[mode]]),
    )

    expect(createColorTokens(mode)).toEqual(expected)
    expect(Object.keys(createColorTokens(mode))).toHaveLength(tokenSource.color.tokens.length)
  })

  it('converte espaço e raios de pixels em pontos nativos sem alterar os valores', () => {
    expect(createNumericTokenMap(tokenSource.spacing.tokens, 'px')).toEqual({
      space1: 4,
      space2: 8,
      space3: 12,
      space4: 16,
      space5: 20,
      space6: 24,
      targetMin: 44,
    })

    expect(createNumericTokenMap(tokenSource.radius.tokens, 'px')).toEqual({
      radiusSm: 12,
      radiusMd: 18,
      radiusLg: 22,
      radiusPill: 999,
    })
  })

  it('converte durações de animação para milissegundos nativos', () => {
    expect(createNumericTokenMap(tokenSource.duration.tokens, 'ms')).toEqual({
      durationFast: 150,
      durationBase: 250,
      durationSlow: 400,
      durationCount: 900,
    })
  })

  it('rejeita unidades inesperadas em vez de produzir medidas inválidas', () => {
    expect(() => createNumericTokenMap([{ name: 'space-1', value: '4rem' }], 'px')).toThrow(
      'Valor de token incompatível com px: 4rem',
    )
  })

  it('converte curvas CSS para os quatro parâmetros aceitos pela animação nativa', () => {
    expect(easingTokens).toEqual({
      easeStandard: [0.2, 0, 0, 1],
      easeEmphasized: [0.3, 0, 0, 1.2],
    })
    expect(() => parseCubicBezierToken('ease-in')).toThrow(
      'Valor de easing incompatível com cubic-bezier: ease-in',
    )
  })
})
