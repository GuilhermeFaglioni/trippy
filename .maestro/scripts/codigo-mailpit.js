/* global EMAIL, http, json, output */

const email = EMAIL

if (!email) {
  throw new Error('Informe EMAIL para buscar o código no Mailpit.')
}

const searchUrl = 'http://localhost:58025/api/v1/search?query=' + encodeURIComponent('to:' + email)
const searchResponse = http.get(searchUrl)

if (!searchResponse.ok) {
  throw new Error('Mailpit respondeu HTTP ' + searchResponse.status + ' na busca de mensagens.')
}

const search = json(searchResponse.body)
const latestMessage = search.messages && search.messages[0]

if (!latestMessage || !latestMessage.ID) {
  throw new Error('Mailpit ainda não recebeu mensagem para o e-mail de teste.')
}

const messageResponse = http.get(
  'http://localhost:58025/api/v1/message/' + encodeURIComponent(latestMessage.ID),
)

if (!messageResponse.ok) {
  throw new Error('Mailpit respondeu HTTP ' + messageResponse.status + ' ao abrir a mensagem.')
}

const message = json(messageResponse.body)
const code = String(message.Text || '').match(/\b\d{6}\b/)

if (!code) {
  throw new Error('Mensagem mais recente do Mailpit não contém código de seis dígitos.')
}

output.codigo = code[0]
