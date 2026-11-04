import { afterEach, describe, expect, it, vi } from 'vitest'
import { main, parseSample25Options } from './sample-25-cli.ts'
import { measuredSample25 } from './sample-25.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function failingFetch() {
  const fetchSpy = vi.fn(() => {
    throw new Error('fetch não deveria ser chamado')
  })
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

describe('parseSample25Options', () => {
  it('usa dry-run por padrão', () => {
    expect(parseSample25Options([])).toEqual({ mode: 'dry-run' })
  })

  it('ignora o separador -- repassado pelo pnpm', () => {
    expect(parseSample25Options(['--'])).toEqual({ mode: 'dry-run' })
  })

  it('recusa --real com erro em português e sem chamar fetch', () => {
    const fetchSpy = failingFetch()
    expect(() => parseSample25Options(['--real'])).toThrow(/bloqueada.*#48/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('recusa opções desconhecidas', () => {
    expect(() => parseSample25Options(['--sem-essa-opcao'])).toThrow(
      /Opção desconhecida: --sem-essa-opcao/,
    )
  })
})

describe('main', () => {
  it('imprime o dry-run em JSON sem chamadas ao fornecedor', async () => {
    const fetchSpy = failingFetch()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main([])

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
    const printed = JSON.parse(String(log.mock.calls[0]?.[0]))
    expect(printed).toMatchObject({ mode: 'dry-run', providerCalls: 0, metrics: null })
    // Uma consulta primária por caso verificado e idioma (PT/EN/local), derivada dos dados.
    expect(printed.plan.primaryRequests).toHaveLength(measuredSample25.length * 3)
  })

  it('recusa --real antes de qualquer chamada ao fornecedor', async () => {
    const fetchSpy = failingFetch()
    await expect(main(['--real'])).rejects.toThrow(/bloqueada/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
