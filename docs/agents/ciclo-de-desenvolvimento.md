# Ciclo de desenvolvimento com agentes

Definido pelo Guilherme em 19/out/2026. Vale para toda issue com o label `ready-for-agent`.

Os agentes rodam no **T3 Code**, com Claude, Gemini (Antigravity) e GPT (Codex) conectados por assinatura. O manual descreve papéis, fluxo e regras sem depender da ferramenta; o que é específico do T3 Code (como lançar um subagente, isolar o trabalho em paralelo e escolher o modelo) está na seção "Operação por harness", no fim. Onde o texto diz "inicia um agente", é uma delegação do T3 Code. As skills (Matt Pocock) ficam em `.agents/skills/`.

## Papéis

| Papel | Modelo |
|---|---|
| **Orquestrador e planejador** (uma sessão por issue; o orquestrador é a sessão principal) | Claude Sonnet 5.5 |
| **Implementador de backend, sync e tarefas mecânicas** (skill `/implement`) | GPT-6 Luna (Max), via assinatura Codex; temporariamente Claude Haiku 5.5 até conectar o GPT |
| **Implementador de UI** (telas e componentes) | Claude Sonnet 5.5 |
| **Revisor independente e dono da esteira** | Gemini 4 Argon, esforço médio |

Definido pelo Guilherme em 04/nov/2026, no lugar do esquema Sonnet + Haiku de 29/out. Os agentes são definidos pelo **papel**, não pelo modelo: trocar de modelo muda só esta tabela, não o fluxo. O revisor usa um modelo de outro provedor de propósito: revisa com viés diferente do de quem implementou. O planejador divide em subtarefas, delega, integra e controla o laço de revisão; o implementador recebe subtarefas pequenas e bem delimitadas (arquivos e critérios explícitos). Subtarefa que o implementador não fecha em duas tentativas volta para o planejador. A UI fica com o Sonnet (veja "Fidelidade às telas").

O **orquestrador** (a sessão principal, com o Guilherme) escolhe as issues da fronteira (sem bloqueio aberto) e dispara um planejador por issue. **Um agente por vez** é o padrão: o Mac tem 16 GB e cada agente pode usar Postgres, Metro e Simulator. Suba a concorrência só se o ambiente aguentar.

## Fluxo de uma issue

1. **Workspace.** Um workspace isolado (worktree Git) por issue, a partir do `develop`, no branch `feat/<nº>-<slug>` (ou `spike/`, `chore/`). Copiar o `.env` da checkout principal (`~/Documents/Development/trippy/.env`); ele nunca entra no Git. Cada issue usa **um banco próprio** no Postgres local (`docker exec trippy-postgres-1 createdb -U trippy trippy_w<nº>`, com o `DATABASE_URL` do `.env` do workspace apontando para ele); o banco `trippy` fica para a checkout principal. Migrations novas pegam o próximo número livre no `develop` e são renumeradas no rebase se outra entrar antes.
2. **Plano.** O planejador lê a issue (`gh issue view <nº> --comments`), as specs citadas e os ADRs, e publica o plano como comentário na issue:
   - subtarefas, cada uma com os arquivos que toca e os critérios de aceite que cobre;
   - quais rodam em paralelo (só subtarefas que **não tocam os mesmos arquivos**) e quais dependem de outras.
3. **Implementação.** O planejador inicia um implementador por subtarefa:
   - em paralelo (só efetivo se a concorrência for maior que 1; com 1 as subtarefas entram em fila), cada um numa **cópia isolada** do branch da issue; o planejador integra os commits no branch da issue;
   - em sequência, no próprio branch da issue.
   - O implementador segue `/implement`: TDD nas fronteiras combinadas, typecheck e testes do arquivo com frequência, a suíte completa no fim (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` quando houver banco), revisão do próprio diff (`/code-review` ou equivalente) e commit.
4. **Revisão.** Com a implementação integrada, o planejador inicia o revisor. Ele confere o diff contra **a issue (critérios de aceite / DoD), as specs e os ADRs**, roda a suíte e publica o veredito como comentário na issue:
   - **Reprovado:** lista objetiva do que falta ou está errado. O planejador repassa ao implementador responsável, que corrige e avisa; então uma **nova revisão** é feita, do zero.
   - **Aprovado:** o revisor segue para o passo 5.
   - Depois de **3 reprovações**, o planejador para, marca a issue com `ready-for-human` e avisa o orquestrador.
5. **PR e esteira.** O revisor abre o PR para o `develop` (ou para o branch da issue-base, se a issue for empilhada; nesse caso a CI não dispara, pois só roda em PRs para `develop`/`main`) (título em português, corpo com `Closes #<nº>`, o que foi feito e como validar), ativa o auto-merge (`gh pr merge --auto --squash --delete-branch`) e acompanha a CI (`gh pr checks --watch`).
6. **Falhas na esteira.** O revisor é responsável por resolver:
   - **check falhando:** lê o log (`gh run view --log-failed`), corrige, roda a suíte localmente e faz push;
   - **conflito com o `develop`:** faz `git rebase origin/develop` (ou merge, se o rebase ficar arriscado), resolve, roda a suíte e faz push com `--force-with-lease`;
   - mudanças de comportamento além de um ajuste pontual voltam para o passo 4 (implementador corrige, nova revisão).
7. **Fim.** O PR entra pelo auto-merge, a issue fecha pelo `Closes`, e o planejador avisa o orquestrador. A worktree pode ser removida.

## Ritmo enxuto (a partir de 29/out/2026)

O ciclo estava lento por excesso de testes e de decisões imediatas. Valem estas regras, que prevalecem sobre o fluxo acima quando houver conflito:

- **Testes em camadas.** Durante a implementação, só typecheck e os testes do arquivo mexido. A suíte completa (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`) roda **uma vez**, antes do PR; o resto fica com a CI. Testes novos cobrem as fronteiras (permissão, convergência offline, validação), não cada componente.
- **E2E só no fim da sprint.** Os testes ponta a ponta, feitos à mão por um agente nos Simulators, ficam em uma issue própria por sprint. Uma feature não espera E2E para ser mergeada.
- **Decidir com padrão.** Dúvida pequena (texto, ordem, nome): o implementador escolhe o padrão mais simples, registra no corpo do PR e segue. `needs-info` só para decisão de produto, custo ou arquitetura fora das specs.
- **Revisão única.** O revisor confere critérios de aceite e riscos (permissão, perda de dados, offline), sem reabrir estilo. Uma reprovação com lista objetiva, no máximo duas.
- **Ambiente travado não bloqueia.** Se o Simulator ou a infraestrutura de E2E falhar, registre numa issue e mergeie a feature com os testes de integração verdes.

## Fidelidade às telas (a partir de 30/out/2026)

Na sprint 2 as telas foram feitas só a partir de `docs/fluxos-e-telas.md` e ficaram longe do que foi desenhado: botões vazando, cards enormes com formulários dentro da lista, abas no lugar errado. A referência visual é obrigatória e prevalece sobre qualquer outra regra deste documento para UI:

- **Fontes da verdade.** As 35 telas em `docs/design/telas/` (PNG + o HTML original com as medidas em `fonte/`) e o design system em `docs/design-system/` (`README.md`, `tokens.json`, `componentes/`). Mudar a tela exige mudar a referência antes, com aprovação do Guilherme.
- **Issue de UI cita a tela.** Toda issue que mexe em tela aponta o PNG de referência, os componentes do design system que a tela usa e os estados (vazio, offline, escuro) que existem em `docs/design/telas/`.
- **Só componentes do design system.** Telas em `apps/mobile/src/features` montam a UI com os componentes de `apps/mobile/src/design-system` (Button, Card, StatusChip, FilterChip, Avatar, Notice, TextField, PlaceRow, TabBar, folha de dias). Sem cor, raio ou espaçamento literal, sem `Pressable`/`TextInput` direto. Componente que falta entra primeiro no design system.
- **Interação como desenhada.** Ações aparecem onde a tela mostra (ícones na linha, folha de dias, segurar e arrastar para reordenar), não como botões extras. Detalhes ficam na tela de detalhe, não na lista.
- **Portão visual.** Antes do PR, a sessão abre a tela no Simulator com dados de exemplo (claro e, se houver referência, escuro), tira o print e põe no corpo do PR lado a lado com o PNG de referência. PR de UI **não** usa auto-merge: fica com `ready-for-human` até o Guilherme aprovar o print. Backend e sync seguem com auto-merge.

## Regras

- Ninguém faz merge manual, contorna a CI ou desliga checks. Push direto no `develop` e no `main` é proibido.
- Segredos só no `.env`. Nada do Google é persistido além do `place_id` (ADR 0001).
- Mudanças de workflow do GitHub Actions não entram por auto-merge: o PR fica para o Guilherme.
- Decisão de produto ou arquitetura que não esteja nas specs: parar e perguntar no comentário da issue, com `needs-info`.
- Todo comentário e PR em português.

## Operação por harness

Esta seção reúne o que depende da ferramenta. O fluxo só exige quatro capacidades: (1) escolher o modelo de cada papel; (2) lançar subagentes a partir do planejador; (3) isolar subagentes paralelos numa cópia do branch da issue; (4) dar acesso ao `gh` e ao shell. Sem (2) ou (3), o planejador implementa em sequência no branch da issue.

### T3 Code (nightly, orquestração v2)

Fonte: `docs/orchestration-v2/orchestrator-mcp-server.md` e `docs/user/` do repositório `pingdotgg/t3code`. O T3 Code é uma superfície de controle sobre os agentes já instalados (Claude, Antigravity, Codex); cada provedor roda com a assinatura da própria conta. Os agentes recebem as ferramentas de orquestração por um servidor MCP do app (`t3-code`).

| Necessidade | Ferramenta do T3 Code |
|---|---|
| Descobrir provedores e modelos | `orchestrator_capabilities` (uma vez por thread, antes da primeira delegação) |
| Subtarefa para um implementador ou revisor | `delegate_task`: cria uma thread filha com `target` (`providerInstanceId`, `model`), `role` (`implementation`, `review`...), `mode` (`async` ou `wait`), `runtimeMode` e `interactionMode` |
| Acompanhar ou parar | `task_status` e `task_cancel`; a conclusão do filho acorda o pai, sem polling |
| Falar com um filho já existente | `t3_thread_send` com `childThreadId` |
| Sessão de nível superior (uma por issue) | `t3_thread_launch` com `workspaceStrategy: worktree` e `baseRef`, ou `create_threads` (1 a 20 de uma vez) |

Os briefs de cada papel estão em `docs/agents/prompts/` (planejador, backend, UI e revisor); copie o modelo, preencha os campos e passe como `task`.

Regras que valem para o ciclo:

- **O filho só recebe o prompt da tarefa** (mais um `role` opcional); o histórico do pai não é copiado. Por isso o brief precisa ser autocontido e mandar ler `AGENTS.md` e este manual.
- **Cada revisão é uma `delegate_task` nova**, com o brief original, os achados anteriores, as respostas e as objeções em aberto. `t3_thread_send` no revisor existente reaproveita a conversa dele e quebra o "revisão do zero".
- **Modos de permissão:** o filho não pode ter permissão mais ampla que a do pai.
- **Paralelismo:** não há limite configurável de concorrência; o planejador controla quantos filhos dispara (padrão: um por vez, por causa dos 16 GB).
- **Worktree:** por padrão, uma thread de issue nasce numa worktree a partir do `origin`. Para um filho paralelo isolado, crie-o numa worktree própria (`t3_thread_launch` com `baseRef` no branch da issue).
- **Mapeamento de papéis** (o modelo vai em cada delegação):
  - planejador: a thread da issue, Claude Sonnet 5.5;
  - backend: `delegate_task` para Claude Haiku 5.5 (GPT via Codex quando for conectado);
  - UI: Claude Sonnet 5.5;
  - revisor: `delegate_task` para o provedor `antigravity`, modelo `gemini-4-argon`, `thinking_level: medium` (informe o nível explicitamente).
- **Antigravity:** lê skills de `.agents/skills`; não consegue reverter a conversa, então correção vai em mensagem nova ou thread nova. Seu `/plan` é o nativo, o modo Plan do T3 Code não está disponível.
- **Claude:** lê skills de `.claude/skills` (links para `.agents/skills`).
- **Trocar de provedor numa thread** gera um resumo de contexto explícito; não é preciso recriar a thread.
- **Scripts no host:** `t3 thread start|send|show|list` (com `--worktree <base-branch>` e `--wait`) cobre o uso fora do app.
