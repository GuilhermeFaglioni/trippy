import type { InvitePreview } from '@trippy/adapters/invites'

const unavailableMessage = 'Este convite não está disponível. Peça um novo link a quem convidou.'

const sharedStyles = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #f4f1ea;
  color: #1c1b19;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 18px;
  line-height: 1.5;
}
main {
  max-width: 640px;
  margin: 0 auto;
  padding: 32px 20px 48px;
}
.card {
  background: #ffffff;
  border: 1px solid #d8d2c4;
  border-radius: 16px;
  padding: 24px;
}
h1 {
  font-size: 1.9rem;
  line-height: 1.2;
  margin: 0 0 12px;
}
h2 {
  font-size: 1.25rem;
  margin: 0 0 8px;
}
p { margin: 0 0 12px; }
.meta { color: #3d3a34; margin: 0 0 6px; }
.roteiro { margin-top: 28px; }
.dia {
  border-top: 1px solid #d8d2c4;
  padding-top: 16px;
  margin-top: 16px;
}
.dia ol { margin: 0; padding-left: 24px; }
.dia li { margin: 4px 0; }
.acao { margin-top: 28px; }
.botao {
  display: block;
  text-align: center;
  background: #0b5d4b;
  color: #ffffff;
  font-weight: 700;
  font-size: 1.1rem;
  text-decoration: none;
  padding: 14px 20px;
  border-radius: 12px;
}
.botao:focus-visible { outline: 3px solid #1c1b19; outline-offset: 3px; }
.ajuda { color: #3d3a34; font-size: 0.95rem; margin-top: 12px; }
@media (min-width: 640px) {
  .botao { display: inline-block; }
}
`

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year}`
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

function formatMemberCount(count: number): string {
  return count === 1 ? '1 pessoa' : `${count} pessoas`
}

function renderDocument(options: { title: string; description: string; body: string }): string {
  const title = escapeHtml(options.title)
  const description = escapeHtml(options.description)
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<style>${sharedStyles}</style>
</head>
<body>
${options.body}
</body>
</html>
`
}

export function renderInviteUnavailablePage(): string {
  return renderDocument({
    title: 'Convite indisponível — Trippy',
    description: unavailableMessage,
    body: `<main>
<div class="card">
<h1>Convite indisponível</h1>
<p>${escapeHtml(unavailableMessage)}</p>
</div>
</main>`,
  })
}

export function renderInvitePage(preview: InvitePreview, codigo: string): string {
  const tripName = escapeHtml(preview.tripName)
  const destination = escapeHtml(preview.destination)
  const period = `${formatDate(preview.startDate)} a ${formatDate(preview.endDate)}`
  const deepLink = escapeHtml(`trippy://convite/${encodeURIComponent(codigo)}`)

  const roteiro =
    preview.days.length === 0
      ? '<p>O roteiro ainda não foi montado.</p>'
      : preview.days
          .map((day) => {
            const date = formatDate(addDays(preview.startDate, day.dayIndex))
            const places = day.places
              .map((place) => `<li>${escapeHtml(place.name)}</li>`)
              .join('\n')
            return `<section class="dia">
<h2>Dia ${day.dayIndex + 1} — ${date}</h2>
<ol>
${places}
</ol>
</section>`
          })
          .join('\n')

  const description = `Convite para ${preview.tripName} em ${preview.destination}, ${period}. ${formatMemberCount(preview.memberCount)} na viagem.`

  return renderDocument({
    title: `Convite para ${preview.tripName} — Trippy`,
    description,
    body: `<main>
<article class="card">
<h1>${tripName}</h1>
<p class="meta">Destino: ${destination}</p>
<p class="meta">Datas: ${period}</p>
<p class="meta">${formatMemberCount(preview.memberCount)}</p>
<section class="roteiro">
<h2>Roteiro</h2>
${roteiro}
</section>
<div class="acao">
<a class="botao" href="${deepLink}">Participar</a>
<p class="ajuda">Se nada acontecer, instale o app Trippy e abra este link novamente.</p>
</div>
</article>
</main>`,
  })
}
