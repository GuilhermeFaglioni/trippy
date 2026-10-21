import type { Context } from 'hono'

type HttpStatus = 400 | 401 | 429 | 503

export class AuthHttpError extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export function handleApiError(error: Error, context: Context) {
  if (error instanceof AuthHttpError) {
    return context.json({ error: error.code, message: error.message }, error.status)
  }
  return context.json({ error: 'internal_error', message: 'Erro interno do servidor.' }, 500)
}
