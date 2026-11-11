# Lista de espera na planilha

A landing envia cada inscrição para um app da web do Google Apps Script, que grava uma linha na aba **Leads** de uma planilha do Google. Mesmo e-mail enviado de novo atualiza a linha em vez de duplicar.

Colunas: `recebido_em`, `nome`, `email`, `whatsapp`, `grupo`, `consentimento`, `utm_source`, `utm_medium`, `utm_campaign`, `referrer`, `pagina`, `idioma` (`pt` ou `en`).

## Instalar

1. Crie uma planilha no Google Sheets (ex.: "Trippy · lista de espera").
2. Em **Extensões → Apps Script**, apague o conteúdo e cole o `Code.gs` desta pasta. Salve.
3. **Implantar → Nova implantação** → tipo **App da Web**.
   - Executar como: **Eu**.
   - Quem pode acessar: **Qualquer pessoa**.
4. Autorize o acesso à planilha quando o Google pedir.
5. Copie a URL que termina em `/exec` e coloque em `apps/landing/.env.local`:

   ```
   VITE_WAITLIST_URL=https://script.google.com/macros/s/…/exec
   ```

   No deploy da landing, a mesma variável vai nas variáveis de ambiente do build.

Ao mudar o `Code.gs`, use **Implantar → Gerenciar implantações → editar → Nova versão** para manter a mesma URL.

## Notas

- A URL `/exec` é pública por natureza; o campo escondido `empresa` no formulário filtra robôs simples. Se aparecer spam, dá para adicionar Cloudflare Turnstile depois.
- Os dados são pessoais (LGPD): compartilhe a planilha só com quem precisa.
