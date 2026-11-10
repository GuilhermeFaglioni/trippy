# Auditoria de produto — 2026-11-10

> Gerado por IA (Claude) durante a auditoria de 10/nov/2026. Rascunho local, ainda não publicado.

**Alvo:** `origin/develop` @ `27a4671bc3b3c3d9d00adeffbb6a6e22a2f4304b` · **Ambiente:** local (Docker + API Hono + iOS Simulator 27.2, iPhone 17 e iPhone 18 Pro) · **Banco:** `trippy_auditoria`

## Resumo executivo

1. **O convidado não entra pelo link.** "Participar" na página do convite abre o app numa tela de erro do Expo ("Unmatched Route"), sem login e sem caminho. O único contorno é copiar só o token de dentro da URL e colar em "Tenho um código de convite". É a porta de entrada de todo convidado. (S1)
2. **Depois de aceitar o convite, o app trava no aviso do recap** e a home fica vazia até a pessoa matar e reabrir o app; quem toca "Agora não" já entrou e já aceitou o termo sem saber.
3. **Offline, o que mais importa na China está errado:** a visita marcada sem internet fica com a hora do sync, não a da visita (quebra sugestão de lugar por foto e o recap), e a tela Hoje não mostra que há registros esperando envio.
4. **A viagem para Xangai nasce com o fuso de São Paulo** (o do celular de quem criou) e não há como corrigir. Dia atual, fase e encerramento viram 11 horas fora do lugar.
5. **Regras de grupo frouxas no servidor:** membro removido volta sozinho pelo mesmo link (convites nunca expiram e não podem ser revogados) e um convidado consegue pôr lugares direto em qualquer dia do roteiro.
6. **"O que mudou" e o status dos lugares contam outra história** que a spec: "O que mudou" só lista lugares novos (inclusive os meus e os sem dia), e o mesmo lugar é "Sugerido" para um e "Sem dia" para outro.
7. O que funciona bem: autorização entre viagens (nenhum vazamento entre grupos), idempotência do sync, conflito de roteiro, convergência entre dois aparelhos, roteiro só leitura para convidado, login por código com limite de tentativas, tema escuro, Estamos aqui sem GPS, página do convite sem dados pessoais e com cabeçalhos de segurança.

**Por onde começar:** 011 → 013 (entrada do convidado), depois 002 + 016 (offline) e 007 (fuso), antes do deploy de 28/nov.

## Números

| Severidade | Qtde | Issues |
|---|---:|---|
| S1 | 1 | 011 |
| S2 | 6 | 001, 002, 007, 008, 013, 016 |
| S3 | 10 | 003, 004, 006, 012, 014, 015, 017, 018, 019, 020 |
| S4 | 1 | 010 |
| Suspeitas (não viram issue) | 2 | 005, 009 |

Por área: fluxo do convite 3 (011, 012, 013) · offline/sync 2 (002, 016) · regra de negócio/segurança 4 (001, 004, 007, 015) · Hoje/UX 3 (008, 017, 018) · lugares 2 (003, 010) · criação/ajustes 2 (006, 019) · identidade 1 (014) · docs 1 (020).

## Issues a criar (ordem sugerida)

| # | Prioridade | Sev. | Título | Relacionadas |
|---|---|---|---|---|
| 011 | P0 | S1 | "Participar" no convite abre o app numa tela de erro; o convidado não consegue entrar pelo link | #62, #68 |
| 013 | P1 | S2 | Depois de aceitar o convite, o app fica preso no aviso e a home continua vazia até reabrir | #61; bloqueada por 011 (mesma tela de entrada) |
| 002 | P1 | S2 | "Eu fui" marcado offline fica com a hora em que sincronizou, não a hora da visita | — |
| 016 | P1 | S2 | Sem internet, a tela Hoje não diz quantos registros ainda não foram enviados | #63 |
| 007 | P1 | S2 | Viagem para Xangai nasce com o fuso do celular de quem criou, sem como corrigir | #21, #60 |
| 001 | P1 | S2 | Membro removido volta sozinho pelo mesmo link; convite não pode ser revogado | #62, #101 |
| 008 | P1 | S2 | "O que mudou" só lista lugares novos, inclusive os meus e os sem dia | #63, #90 |
| 004 | P1 | S3 | Membro comum consegue pôr lugar em qualquer dia do roteiro pelo sync | #67 |
| 017 | P2 | S3 | Depois de "Eu fui", a linha perde Favorito e Foto ("os 1 lugares") | #63, #90 |
| 003 | P2 | S3 | Comentário escrito ao sugerir um lugar não aparece para o grupo | #86, #87 |
| 014 | P2 | S3 | Ninguém escolhe o próprio nome: o grupo vê um nome tirado do e-mail | #102 |
| 018 | P2 | S3 | Fonte grande: abas quebram no meio da palavra e números do dia cortados (`accessibility`) | #85 |
| 012 | P2 | S3 | Página web do convite não segue a referência 27 | #62; depois de 011 |
| 006 | P2 | S3 | Datas da viagem digitadas como texto livre, sem seletor | #92 |
| 019 | P2 | S3 | "Encerrar viagem" promete mudar a data de volta e gerar o recap, mas só marca encerrada | #60 |
| 015 | P2 | S3 | (enhancement, needs-info) O mesmo lugar é "Sugerido" para uns e "Sem dia" para outros | #86 |
| 020 | P3 | S3 | (enhancement, needs-info) Docs dizem sucessão automática do organizador; o app bloqueia a saída (#101) | #101 |
| 010 | P3 | S4 | Busca de lugares indisponível aparece como "erro de servidor, seus dados estão salvos" | ADR 0001 |

## Comentários em issues existentes

- **#68** (E2E da sprint 2, aberta): o E2E pedido teria pego 011 e 013; evidência de que o `pod install` quebra sem `LANG=en_US.UTF-8` (critério já citado na issue).
- **#93** (Sprint 3, aberta): desvios visuais encontrados (012, 017, 018) para a lista da sprint.

## Cobertura

| Fluxo (fluxos-e-telas.md) | Estado |
|---|---|
| 1 Primeiro uso | com achados (011, 013; 005 suspeita) |
| 2 Criar viagem | com achados (006, 007) — home vazia e Nova viagem fiéis às refs 29/03 |
| 3 Entrar na viagem | com achados (011, 012, 013, 001) |
| 4 Sugerir lugar | com achados (003, 010); busca/link/Detalhes do Google **não testados** (sem chaves Geoapify/Google no `.env`) |
| 5 Montar roteiro | escolher dia ok; arrastar/reordenar não testado à mão; conflito testado pela API ok; 004 |
| 6 Pronto para viajar | não testado (viagem de teste já em andamento) |
| 7 Hoje | com achados (008, 016, 017, 018); Estamos aqui sem GPS ok |
| 8 Tela do lugar / cartão | não testado à mão |
| 9 Fotos | não testado (fora da sprint atual) |
| 10 Grupo | parcial: convite ok; promover/remover testado pela API ok; sair não testado à mão; 020 |
| 11 Recap | não implementado (plano 17–27/nov); 019 sobre o texto |
| 12 Memórias | não testado |
| 13 Conta e assinatura | não implementado (fora do beta) |

Regras pela API: papéis (roteiro, papéis, remover, encerrar) ok; objetos de outra viagem ok; idempotência ok; mass assignment ok; validação de nota/observação/nome ok; 001, 004 com achados.

## Linha de base

lint, typecheck, `test:integration`, `format:check`: ok. `pnpm test`: 1 falha (timeout de 5 s no teste do `TabBar`) só com a máquina sob carga do `xcodebuild`; passa isolado 3×. `pnpm audit --prod`: 3 moderadas + 1 baixa, nenhuma alta/crítica (o CI usa `--audit-level high`). `expo-doctor`: 17 pacotes Expo com patch atrasado (não bloqueia).

## Segurança (resumo)

Sem vazamento entre viagens (BOLA/BFLA testados com 4 personas). JWT `alg:none` e payload trocado recusados; refresh com rotação e detecção de reuso; logout revoga refresh (access token de 15 min segue válido até expirar, esperado). OTP: 4 tentativas e bloqueio; 60 s entre códigos por e-mail, sem limite por IP (só no adaptador dev; produção usa Cognito). Página do convite com CSP, `noindex`, `no-referrer`, HTML escapado. Workflows: permissões mínimas, actions por SHA, `persist-credentials: false`, auto-merge só do Dependabot para patch/minor fora de `github_actions`. Nenhum segredo no repo além das chaves dev documentadas.

## Suspeitas (não viram issue)

- **005** Login usa um e-mail e verifica outro; **009** campo de busca perde caracteres. A ferramenta de digitação do Simulator perdeu teclas de forma intermitente em vários campos, inclusive num teste de controle; precisa de teste com digitação humana.
- Toque no `Switch` "Simular sem internet" não muda o estado (só arrastando). Pode ser a ferramenta; é só tela de dev.
- Teste `TabBar` com timeout sob carga (acima).

## Não testado e por quê

- Busca por nome/endereço/link do Google e "Detalhes do Google": `.env` local sem `GEOAPIFY_API_KEY`/`GOOGLE_PLACES_API_KEY`.
- Arrastar para reordenar o roteiro à mão, tela do lugar, cartão para mostrar, Pronto para viajar, fotos, memórias, sair do grupo, encerrar viagem pelo app, VoiceOver, iPhone pequeno, Android.
- Preview do convite no WhatsApp (precisa URL pública).
- Divergência da skill: `references/teste-no-simulador.md` diz que o Maestro foi removido, mas `.maestro/` existe no SHA auditado.
