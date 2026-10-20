import tokenSource from '../../../../../docs/design-system/tokens.json'
import { createDesignTheme, resolveThemeMode } from '../theme-model'

describe('contrato de tema', () => {
  it('segue o esquema do sistema e usa claro quando o sistema não informa preferência', () => {
    expect(resolveThemeMode('light')).toBe('light')
    expect(resolveThemeMode('dark')).toBe('dark')
    expect(resolveThemeMode(null)).toBe('light')
  })

  it.each(['light', 'dark'] as const)('expõe a paleta oficial no tema %s', (mode) => {
    const theme = createDesignTheme(mode)
    const officialTerracotta = tokenSource.color.tokens.find(({ name }) => name === 'terracotta')

    expect(theme.mode).toBe(mode)
    expect(theme.colors.terracotta).toBe(officialTerracotta?.value[mode])
    expect(theme.colors.ink).toBe(
      tokenSource.color.tokens.find(({ name }) => name === 'ink')?.value[mode],
    )
    expect(Object.keys(theme.colors)).toHaveLength(tokenSource.color.tokens.length)
  })

  it('expõe medidas numéricas convertidas diretamente dos tokens oficiais', () => {
    const theme = createDesignTheme('light')

    expect(theme.spacing.space5).toBe(20)
    expect(theme.spacing.targetMin).toBe(44)
    expect(theme.radius.radiusSm).toBe(12)
    expect(theme.duration.durationFast).toBe(150)
    expect(theme.easing.easeStandard).toEqual([0.2, 0, 0, 1])
    expect(theme.shadow.shadowFab).toBe(tokenSource.shadow.tokens[0].value)
  })
})
