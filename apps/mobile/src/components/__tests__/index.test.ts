import * as components from '..'

describe('barrel de componentes mobile', () => {
  it('expõe os quatro componentes e tipos de contrato via barrel', () => {
    expect(components.Button).toBeDefined()
    expect(components.Card).toBeDefined()
    expect(components.TextField).toBeDefined()
    expect(components.Notice).toBeDefined()
  })
})
