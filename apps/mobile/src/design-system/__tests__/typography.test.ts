import tokenSource from '../../../../../docs/design-system/tokens.json'
import { createTypographyTokens, getFontFamilyForPlatform, TEXT_SCALING_PROPS } from '../typography'

function firstFontFamily(tokenFamily: string): string {
  return tokenFamily
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

describe('contrato de tipografia nativa', () => {
  it('usa as famílias de exibição e texto declaradas no design system', () => {
    expect(getFontFamilyForPlatform('display', 'ios')).toBe(
      firstFontFamily(tokenSource.type.families.display),
    )
    expect(getFontFamilyForPlatform('sans', 'android')).toBe(
      firstFontFamily(tokenSource.type.families.sans),
    )
  })

  it('usa fallback de sistema local por plataforma para alfabetos cobertos pelo SO', () => {
    const localFallbacks = tokenSource.type.families.local
      .split(',')
      .map((family) => family.trim().replace(/^['"]|['"]$/g, ''))

    expect(getFontFamilyForPlatform('local', 'ios')).toBeUndefined()
    expect(getFontFamilyForPlatform('local', 'android')).toBe(localFallbacks.at(-1))
    expect(getFontFamilyForPlatform('local', 'web')).toBe(localFallbacks.at(-2))
  })

  it('converte estilos tipográficos em valores nativos e mantém escala de texto até 200%', () => {
    const styles = createTypographyTokens('ios')

    expect(styles.hero).toMatchObject({
      fontFamily: firstFontFamily(tokenSource.type.families.display),
      fontSize: 40,
      lineHeight: 42,
      fontWeight: '700',
      letterSpacing: -1,
    })
    expect(styles.label).toMatchObject({
      fontSize: 13,
      textTransform: 'uppercase',
    })
    expect(TEXT_SCALING_PROPS).toEqual({
      allowFontScaling: true,
      maxFontSizeMultiplier: 2,
    })
  })
})
