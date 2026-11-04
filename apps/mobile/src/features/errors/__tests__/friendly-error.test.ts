import { classifyError, FRIENDLY_MESSAGES, friendlyErrorMessage } from '../friendly-error'

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

describe('friendlyErrorMessage', () => {
  it.each([
    [new TypeError('fetch failed: Could not connect to the server'), 'offline'],
    [new Error('Network request failed'), 'offline'],
    [new ApiError(503, 'Service Unavailable'), 'server'],
    [new ApiError(500, 'Internal Server Error'), 'server'],
    [new ApiError(401, 'Unauthorized'), 'session'],
    [new Error('SQLITE_CONSTRAINT: boom'), 'unexpected'],
    ['qualquer coisa', 'unexpected'],
  ])('classifica %p como %s', (error, kind) => {
    expect(classifyError(error)).toBe(kind)
  })

  it('nunca expõe texto técnico, inglês ou código HTTP', () => {
    for (const error of [
      new TypeError('fetch failed: Could not connect to the server'),
      new ApiError(502, 'Bad Gateway'),
      new ApiError(404, 'HTTP 404 not found'),
      new Error('TypeError: undefined is not an object'),
    ]) {
      const message = friendlyErrorMessage(error)
      expect(message).not.toMatch(/fetch|http|\b\d{3}\b|undefined|Error|Gateway/iu)
    }
  })

  it('mantém a mensagem da API quando ela já está em português simples', () => {
    expect(friendlyErrorMessage(new ApiError(422, 'Informe o nome da viagem.'))).toBe(
      'Informe o nome da viagem.',
    )
  })

  it('usa o texto da tela só para falhas inesperadas', () => {
    expect(friendlyErrorMessage(new Error('boom'), 'Não foi possível salvar o favorito.')).toBe(
      'Não foi possível salvar o favorito.',
    )
    expect(friendlyErrorMessage(new TypeError('x'), 'Não foi possível salvar.')).toBe(
      FRIENDLY_MESSAGES.offline,
    )
  })
})
