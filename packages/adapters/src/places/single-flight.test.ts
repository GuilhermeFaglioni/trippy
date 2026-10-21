import { describe, expect, it, vi } from 'vitest'
import { SingleFlight } from './single-flight.ts'

describe('single-flight', () => {
  it('compartilha chamada concorrente para a mesma chave e limpa o voo concluído', async () => {
    const flight = new SingleFlight()
    let resolve!: (value: string) => void
    const request = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done
        }),
    )

    const first = flight.run('place-1', request)
    const second = flight.run('place-1', request)
    expect(request).toHaveBeenCalledTimes(1)
    resolve('resultado')
    await expect(Promise.all([first, second])).resolves.toEqual(['resultado', 'resultado'])

    await flight.run('place-1', async () => 'novo resultado')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('permite chaves distintas e remove voo que falhou', async () => {
    const flight = new SingleFlight()
    const request = vi.fn(async (value: string) => value)

    await expect(Promise.all([flight.run('a', () => request('a')), flight.run('b', () => request('b'))]))
      .resolves.toEqual(['a', 'b'])
    await expect(flight.run('falha', async () => Promise.reject(new Error('erro')))).rejects.toThrow(
      'erro',
    )
    await expect(flight.run('falha', async () => 'retomada')).resolves.toBe('retomada')
  })
})
