import type { LivePlace } from '@trippy/sync'
import { addressCardState } from '../address-card-model'

type Fields = Pick<
  LivePlace,
  'name' | 'address' | 'localName' | 'localAddress' | 'userLocalName' | 'userLocalAddress'
>

function fields(overrides: Partial<Fields> = {}): Fields {
  return {
    name: 'Museu da Cidade',
    address: null,
    localName: null,
    localAddress: null,
    userLocalName: null,
    userLocalAddress: null,
    ...overrides,
  }
}

describe('addressCardState', () => {
  it('usa o endereço local do usuário com o nome local do usuário', () => {
    expect(
      addressCardState(
        fields({
          localName: '市立博物館',
          localAddress: '提供者地址',
          userLocalName: '市立美术馆',
          userLocalAddress: '1-2 中央路',
          address: 'City Museum, 1 Main Road',
        }),
      ),
    ).toEqual({ kind: 'local', name: '市立美术馆', address: '1-2 中央路', source: 'user' })
  })

  it('usa o endereço local do fornecedor quando o usuário não informou', () => {
    expect(
      addressCardState(fields({ localName: '市立博物館', localAddress: '中央路 1 号' })),
    ).toEqual({ kind: 'local', name: '市立博物館', address: '中央路 1 号', source: 'provider' })
  })

  it('cai para o nome do lugar quando não há nome local', () => {
    expect(addressCardState(fields({ userLocalAddress: 'Rua Local, 10' }))).toEqual({
      kind: 'local',
      name: 'Museu da Cidade',
      address: 'Rua Local, 10',
      source: 'user',
    })
  })

  it('mostra só o endereço do fornecedor quando não há endereço local', () => {
    expect(addressCardState(fields({ address: 'City Museum, 1 Main Road' }))).toEqual({
      kind: 'vendor',
      name: 'Museu da Cidade',
      address: 'City Museum, 1 Main Road',
    })
  })

  it('fica vazio quando não há nenhum endereço', () => {
    expect(addressCardState(fields())).toEqual({ kind: 'empty', name: 'Museu da Cidade' })
  })

  it('trata strings vazias e só com espaços como ausentes', () => {
    expect(
      addressCardState(
        fields({ address: '   ', localAddress: '', userLocalAddress: '  \n ', userLocalName: ' ' }),
      ),
    ).toEqual({ kind: 'empty', name: 'Museu da Cidade' })
    expect(addressCardState(fields({ address: '  Rua A, 1  ', userLocalAddress: '   ' }))).toEqual({
      kind: 'vendor',
      name: 'Museu da Cidade',
      address: 'Rua A, 1',
    })
  })
})
