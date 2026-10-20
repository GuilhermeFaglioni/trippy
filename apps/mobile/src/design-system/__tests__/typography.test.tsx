import tokenSource from '../../../../../docs/design-system/tokens.json'
import { render } from '@testing-library/react-native'
import {
  createTypographyTokens,
  getFontFamilyForPlatform,
  getTypographyFontRuns,
  getTextInputFontFamily,
  normalizeFontPlatform,
  TEXT_SCALING_PROPS,
} from '../typography'
import { TypographyText } from '../typography-text'

function firstFontFamily(tokenFamily: string): string {
  return tokenFamily
    .split(',')[0]
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

describe('contrato de tipografia nativa', () => {
  it('usa as famílias display e sans declaradas no design system', () => {
    expect(getFontFamilyForPlatform('display', 'ios')).toBe(
      firstFontFamily(tokenSource.type.families.display),
    )
    expect(getFontFamilyForPlatform('sans', 'android')).toBe(
      firstFontFamily(tokenSource.type.families.sans),
    )
  })

  it.each(['ios', 'android', 'web'] as const)(
    'normaliza a plataforma nativa %s para tipografia',
    (platform) => {
      expect(normalizeFontPlatform(platform)).toBe(platform)
    },
  )

  it('converte os estilos numéricos e metadados dos tokens para TextStyle', () => {
    const styles = createTypographyTokens('ios')

    expect(styles.hero).toMatchObject({
      fontFamily: firstFontFamily(tokenSource.type.families.display),
      fontSize: 40,
      lineHeight: 42,
      fontWeight: '700',
      letterSpacing: -1,
    })
    expect(styles.label).toMatchObject({ fontSize: 13, textTransform: 'uppercase' })
  })

  it.each([
    ['zh-CN', 'Noto Sans SC'],
    ['ja-JP', 'Noto Sans JP'],
    ['ko-KR', 'Noto Sans KR'],
  ])('seleciona a família local do idioma %s', (locale, expectedFamily) => {
    for (const platform of ['ios', 'android', 'web'] as const) {
      expect(getFontFamilyForPlatform('local', platform, locale)).toBe(expectedFamily)
    }

    expect(tokenSource.type.families.local).toContain(expectedFamily)
  })

  it.each([
    ['zh-CN', 'Noto Sans SC'],
    ['ja-JP', 'Noto Sans JP'],
    ['ko-KR', 'Noto Sans KR'],
  ])('aplica %s diretamente em cardName e cardAddress', (locale, expectedFamily) => {
    const styles = createTypographyTokens('ios', locale)

    expect(styles.cardName.fontFamily).toBe(expectedFamily)
    expect(styles.cardAddress.fontFamily).toBe(expectedFamily)
  })

  it('usa Noto JP em nomes Han-only com locale japonês', () => {
    expect(getTypographyFontRuns('東京', 'local', 'ios', 'ja-JP')).toEqual([
      { text: '東京', fontFamily: 'Noto Sans JP' },
    ])
  })

  it('mantém fonte display em latino e alterna para Noto JP no trecho CJK', () => {
    expect(getTypographyFontRuns('Trippy 東京', 'display', 'ios', 'ja-JP')).toEqual([
      { text: 'Trippy ', fontFamily: 'Bricolage Grotesque' },
      { text: '東京', fontFamily: 'Noto Sans JP' },
    ])
  })

  it('mantém DM Sans em latino e escolhe Noto KR pela escrita Hangul', () => {
    expect(getTypographyFontRuns('Seoul 서울', 'sans', 'android', 'en-US')).toEqual([
      { text: 'Seoul ', fontFamily: 'DM Sans' },
      { text: '서울', fontFamily: 'Noto Sans KR' },
    ])
  })

  it('escolhe Noto JP pela escrita kana sem depender do locale do sistema', () => {
    expect(getTypographyFontRuns('かな', 'sans', 'ios', 'pt-BR')).toEqual([
      { text: 'かな', fontFamily: 'Noto Sans JP' },
    ])
  })

  it('usa a pontuação CJK com a família selecionada pelo idioma', () => {
    expect(getTypographyFontRuns('你好，世界', 'sans', 'ios', 'zh-CN')).toEqual([
      { text: '你好，世界', fontFamily: 'Noto Sans SC' },
    ])
  })

  it('mantém Noto local para o texto inteiro de cardName e cardAddress', () => {
    expect(getTypographyFontRuns('Hotel Kyoto 京都', 'local', 'ios', 'ja-JP')).toEqual([
      { text: 'Hotel Kyoto 京都', fontFamily: 'Noto Sans JP' },
    ])
  })

  it('escolhe fonte única apropriada para campo de texto com escrita CJK', () => {
    expect(getTextInputFontFamily('Seoul 서울', 'sans', 'ios', 'en-US')).toBe('Noto Sans KR')
    expect(getTextInputFontFamily('Recife', 'sans', 'ios', 'ko-KR')).toBe('DM Sans')
  })

  it('mantém Dynamic Type até 200%', () => {
    expect(TEXT_SCALING_PROPS).toEqual({
      allowFontScaling: true,
      maxFontSizeMultiplier: 2,
    })
  })

  it('renderiza display latino e Noto JP em trechos tipográficos separados', async () => {
    const utils = await render(
      <TypographyText family="display" locale="ja-JP" style={{ fontSize: 32 }}>
        Trippy 東京
      </TypographyText>,
    )

    expect(utils.getByText('Trippy ')).toHaveStyle({ fontFamily: 'Bricolage Grotesque' })
    expect(utils.getByText('東京')).toHaveStyle({ fontFamily: 'Noto Sans JP' })
  })

  it('aplica família local e escala tokenizada em cardName coreano', async () => {
    const utils = await render(
      <TypographyText family="local" locale="ko-KR" style={createTypographyTokens('ios').cardName}>
        서울 여행
      </TypographyText>,
    )

    expect(utils.getByText('서울 여행')).toHaveStyle({
      fontFamily: 'Noto Sans KR',
      fontSize: 72,
    })
    expect(utils.getByText('서울 여행')).toHaveProp('maxFontSizeMultiplier', 2)
  })
})
