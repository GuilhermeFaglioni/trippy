import tokenSource from '../../../../../docs/design-system/tokens.json'
import { customFontAssets } from '../fonts'

describe('assets locais das famílias de fonte', () => {
  it('carrega as famílias oficiais para display, sans e os alfabetos CJK locais', () => {
    const tokenFamilies = tokenSource.type.families
    const localFamilies = tokenFamilies.local
      .split(',')
      .map((family) => family.trim().replace(/^['"]|['"]$/g, ''))
    const expectedFamilies = [
      tokenFamilies.display
        .split(',')[0]
        .trim()
        .replace(/^['"]|['"]$/g, ''),
      tokenFamilies.sans
        .split(',')[0]
        .trim()
        .replace(/^['"]|['"]$/g, ''),
      ...localFamilies.filter((family) => /^Noto Sans (SC|JP|KR)$/.test(family)),
    ]

    expect(Object.keys(customFontAssets)).toEqual(expectedFamilies)
  })
})
