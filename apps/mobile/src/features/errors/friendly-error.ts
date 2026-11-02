/**
 * Mapeamento único de falhas para mensagens em português simples ("Tom e conteúdo" do design system):
 * diz o que aconteceu com os dados e o que a pessoa pode fazer. O detalhe técnico vai só para o log.
 */
export type ErrorKind = 'offline' | 'server' | 'session' | 'unexpected'

export const FRIENDLY_MESSAGES: Record<ErrorKind, string> = {
  offline: 'Sem conexão. O que já está salvo neste aparelho continua aqui.',
  server:
    'Não deu para falar com o servidor agora. Seus dados estão salvos neste aparelho; tente de novo daqui a pouco.',
  session: 'Sua sessão expirou. Entre de novo para continuar.',
  unexpected: 'Algo não saiu como esperado. Seus dados continuam salvos; tente de novo.',
}

const NETWORK_PATTERN =
  /network request failed|fetch failed|failed to fetch|could not connect|connection (?:refused|reset)|timed? ?out|timeout|offline|econn|enotfound|internet/iu
const TECHNICAL_PATTERN =
  /\b(?:http|https|api|json|sql|sqlite|null|undefined|nan|stack|exception|status|request|response|fetch|network|server|error|failed|invalid|unauthorized|forbidden)\b|\b[1-5]\d{2}\b|\w+Error\b|[{}[\]<>]|\bat \w+\./iu
const PORTUGUESE_HINT =
  /[ãõçáéíóúâêô]|\b(?:não|você|voce|este|esta|tente|viagem|lugar|nome|data|grupo|convite|campo|preencha|informe)\b/iu

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

export function classifyError(error: unknown): ErrorKind {
  const status = statusOf(error)
  if (status === 401) return 'session'
  if (status !== null && status >= 500) return 'server'
  if (status === 429) return 'server'
  if (status === 0) return 'offline'
  if (error instanceof TypeError) return 'offline'
  if (error instanceof Error && NETWORK_PATTERN.test(error.message)) return 'offline'
  return 'unexpected'
}

/** Mensagem escrita por nós ou pela API em português e sem jargão pode ser mostrada como está. */
function isPlainPortuguese(message: string): boolean {
  return PORTUGUESE_HINT.test(message) && !TECHNICAL_PATTERN.test(message)
}

/**
 * `fallback` substitui só o caso inesperado, para a tela dizer o que não foi feito
 * ("Não foi possível salvar o favorito.").
 */
export function friendlyErrorMessage(error: unknown, fallback?: string): string {
  const kind = classifyError(error)
  if (kind !== 'unexpected') return FRIENDLY_MESSAGES[kind]
  if (error instanceof Error && isPlainPortuguese(error.message.trim())) return error.message.trim()
  return fallback ?? FRIENDLY_MESSAGES.unexpected
}

/** Detalhe técnico fica só no log de desenvolvimento. */
export function logTechnicalError(context: string, error: unknown): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn(`[${context}]`, error)
}

/** "Última atualização às 14:32 · 2 alterações aguardando envio": o app nunca finge estar atualizado. */
export function describeSyncStatus(status: {
  lastSyncedAt: string | null
  pending: number
  notSent?: number
}): string {
  const parts: string[] = []
  const syncedAt = status.lastSyncedAt === null ? null : new Date(status.lastSyncedAt)
  if (syncedAt === null || Number.isNaN(syncedAt.getTime())) {
    parts.push('Ainda não atualizamos neste aparelho.')
  } else {
    const hour = syncedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    parts.push(`Última atualização às ${hour}.`)
  }
  const waiting = status.pending + (status.notSent ?? 0)
  if (waiting > 0) {
    parts.push(`${waiting} ${waiting === 1 ? 'alteração aguarda' : 'alterações aguardam'} o envio.`)
  }
  return parts.join(' ')
}
