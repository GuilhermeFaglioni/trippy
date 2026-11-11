const ENDPOINT = import.meta.env.VITE_WAITLIST_URL?.trim() ?? ''
const LANG = document.documentElement.lang.startsWith('en') ? 'en' : 'pt'

const TEXT = {
  pt: {
    nome: 'Escreva seu nome.',
    emailVazio: 'Escreva seu e-mail.',
    emailInvalido: 'Confira o e-mail. Ele precisa ter @ e domínio, como nome@email.com.',
    whatsapp: 'Confira o número, com DDD. Ou deixe em branco.',
    naoConfigurada: 'A lista ainda não está configurada (VITE_WAITLIST_URL).',
    falha: 'Não deu para enviar agora. Confira sua conexão e tente de novo.',
    pronto: (nome: string) => `Pronto, ${nome}. Você está na lista.`,
  },
  en: {
    nome: 'Enter your name.',
    emailVazio: 'Enter your email.',
    emailInvalido: 'Check the email. It needs an @ and a domain, like name@email.com.',
    whatsapp: 'Check the number, with country code. Or leave it blank.',
    naoConfigurada: 'The waitlist is not set up yet (VITE_WAITLIST_URL).',
    falha: 'Could not send right now. Check your connection and try again.',
    pronto: (nome: string) => `Done, ${nome}. You are on the list.`,
  },
}[LANG]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

type FieldName = 'nome' | 'email' | 'whatsapp'

function utm() {
  const p = new URLSearchParams(location.search)
  return {
    utm_source: p.get('utm_source') ?? '',
    utm_medium: p.get('utm_medium') ?? '',
    utm_campaign: p.get('utm_campaign') ?? '',
  }
}

export function setupWaitlist(form: HTMLFormElement) {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
  const status = form.querySelector<HTMLParagraphElement>('#form-status')!
  const input = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement

  function setError(name: FieldName, message: string) {
    const el = input(name)
    const err = form.querySelector<HTMLElement>(`#${name}-erro`)!
    if (message) {
      el.setAttribute('aria-invalid', 'true')
      el.setAttribute('aria-describedby', `${name}-erro`)
      err.textContent = message
      err.hidden = false
    } else {
      el.removeAttribute('aria-invalid')
      el.removeAttribute('aria-describedby')
      err.textContent = ''
      err.hidden = true
    }
  }

  function validate() {
    const nome = input('nome').value.trim()
    const email = input('email').value.trim()
    const whatsapp = input('whatsapp').value.replace(/\D/g, '')
    const errors: Partial<Record<FieldName, string>> = {}
    if (nome.length < 2) errors.nome = TEXT.nome
    if (!email) errors.email = TEXT.emailVazio
    else if (!EMAIL_RE.test(email)) errors.email = TEXT.emailInvalido
    if (whatsapp && (whatsapp.length < 8 || whatsapp.length > 15)) errors.whatsapp = TEXT.whatsapp
    ;(['nome', 'email', 'whatsapp'] as const).forEach((f) => setError(f, errors[f] ?? ''))
    return { ok: Object.keys(errors).length === 0, errors, nome, email, whatsapp }
  }

  // revalida o campo ao sair dele, depois da primeira tentativa
  let tried = false
  form.addEventListener('focusout', () => {
    if (tried) validate()
  })
  form.addEventListener('change', () => {
    if (tried) validate()
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    tried = true
    status.textContent = ''
    status.removeAttribute('data-tone')
    const v = validate()
    if (!v.ok) {
      const first = (['nome', 'email', 'whatsapp'] as const).find((f) => v.errors[f])
      if (first) input(first).focus()
      return
    }
    // robô preencheu o campo escondido: finge sucesso e não envia
    if (input('empresa').value) return done(v.nome)

    if (!ENDPOINT) {
      fail(TEXT.naoConfigurada)
      return
    }

    button.setAttribute('aria-busy', 'true')
    button.disabled = true
    try {
      const payload = {
        nome: v.nome,
        email: v.email.toLowerCase(),
        whatsapp: v.whatsapp,
        grupo: input('grupo').value,
        idioma: LANG,
        // enviar o formulário é o aceite (texto abaixo do botão)
        consentimento: true,
        pagina: location.origin + location.pathname,
        referrer: document.referrer,
        ...utm(),
      }
      // text/plain evita o preflight de CORS, que o Apps Script não responde
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      })
      const body = (await res.json().catch(() => null)) as { ok?: boolean } | null
      if (!res.ok || !body?.ok) throw new Error('falha')
      done(v.nome)
    } catch {
      fail(TEXT.falha)
    } finally {
      button.removeAttribute('aria-busy')
      button.disabled = false
    }
  })

  function fail(message: string) {
    status.dataset.tone = 'erro'
    status.textContent = message
  }

  function done(nome: string) {
    const primeiro = nome.split(/\s+/)[0]
    form.classList.add('is-done')
    status.textContent = TEXT.pronto(primeiro ?? nome)
    status.tabIndex = -1
    status.focus()
  }
}
