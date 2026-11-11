/**
 * Recebe os leads da landing do Trippy e grava uma linha por pessoa na planilha.
 * Instalação em apps-script/README.md.
 */

const ABA = 'Leads'
const COLUNAS = [
  'recebido_em',
  'nome',
  'email',
  'whatsapp',
  'grupo',
  'consentimento',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'referrer',
  'pagina',
  'idioma',
]

function doPost(e) {
  const lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    const dados = JSON.parse((e && e.postData && e.postData.contents) || '{}')
    const nome = limpar(dados.nome, 120)
    const email = limpar(dados.email, 200).toLowerCase()
    if (
      nome.length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ||
      dados.consentimento !== true
    ) {
      return responder({ ok: false, erro: 'dados_invalidos' })
    }

    const aba = abaDeLeads()
    // mesmo e-mail de novo: atualiza a linha em vez de duplicar
    const emails =
      aba.getLastRow() > 1 ? aba.getRange(2, 3, aba.getLastRow() - 1, 1).getValues() : []
    const existente = emails.findIndex(function (linha) {
      return linha[0] === email
    })

    const linha = [
      new Date(),
      nome,
      email,
      limpar(dados.whatsapp, 20),
      limpar(dados.grupo, 40),
      'sim',
      limpar(dados.utm_source, 100),
      limpar(dados.utm_medium, 100),
      limpar(dados.utm_campaign, 100),
      limpar(dados.referrer, 300),
      limpar(dados.pagina, 300),
      limpar(dados.idioma, 5),
    ]
    if (existente >= 0) aba.getRange(existente + 2, 1, 1, linha.length).setValues([linha])
    else aba.appendRow(linha)

    return responder({ ok: true })
  } catch (erro) {
    return responder({ ok: false, erro: 'falha_interna' })
  } finally {
    lock.releaseLock()
  }
}

function abaDeLeads() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet()
  let aba = planilha.getSheetByName(ABA)
  if (!aba) {
    aba = planilha.insertSheet(ABA)
    aba.appendRow(COLUNAS)
    aba.setFrozenRows(1)
  }
  return aba
}

// Evita fórmula injetada na planilha (=, +, -, @ no início) e corta o tamanho.
function limpar(valor, max) {
  let texto = String(valor == null ? '' : valor)
    .trim()
    .slice(0, max)
  if (/^[=+\-@]/.test(texto)) texto = "'" + texto
  return texto
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  )
}
