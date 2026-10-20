# Ciclo de desenvolvimento com agentes

Definido pelo Guilherme em 19/out/2026. Vale para toda issue com o label `ready-for-agent`. Os agentes são iniciados pelo Orca (`orca worktree create` / `orca agent launch`; guia em `orca skills get orca-cli`).

## Papéis

| Papel | Tarefas do Claude | Tarefas do Codex |
|---|---|---|
| **Planejador** | `--agent claude --model claude-opus-5-5 --effort medium` | `--agent codex --model gpt-6.1-sol --effort low` |
| **Implementadores** (swarm) | `--agent codex --model gpt-6-luna --effort xhigh`, seguindo a skill `/implement` | igual |
| **Revisor** | `--agent codex --model gpt-6.1-sol --effort low` | igual |

O **orquestrador** (a sessão do Claude Code com o Guilherme) escolhe as issues da fronteira (sem bloqueio aberto), cria uma worktree por issue e inicia o planejador nela.

## Fluxo de uma issue

1. **Worktree.** Uma worktree do Orca por issue, a partir do `develop`, no branch `feat/<nº>-<slug>` (ou `spike/`, `chore/`). Copiar o `.env` da checkout principal (`/Users/guilhermefaglioni/orca/projects/Trippy/.env`); ele nunca entra no Git.
2. **Plano.** O planejador lê a issue (`gh issue view <nº> --comments`), as specs citadas e os ADRs, e publica o plano como comentário na issue:
   - subtarefas, cada uma com os arquivos que toca e os critérios de aceite que cobre;
   - quais rodam em paralelo (só subtarefas que **não tocam os mesmos arquivos**) e quais dependem de outras.
3. **Implementação.** O planejador inicia um implementador por subtarefa:
   - em paralelo, cada um numa **worktree filha** criada a partir do branch da issue (`--parent-worktree active --base-branch <branch da issue>`); o planejador integra os commits no branch da issue;
   - em sequência, no próprio branch da issue.
   - O implementador segue `/implement`: TDD nas fronteiras combinadas, typecheck e testes do arquivo com frequência, a suíte completa no fim (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` quando houver banco), `/code-review` e commit.
4. **Revisão.** Com a implementação integrada, o planejador inicia o revisor. Ele confere o diff contra **a issue (critérios de aceite / DoD), as specs e os ADRs**, roda a suíte e publica o veredito como comentário na issue:
   - **Reprovado:** lista objetiva do que falta ou está errado. O planejador repassa ao implementador responsável, que corrige e avisa; então uma **nova revisão** é feita, do zero.
   - **Aprovado:** o revisor segue para o passo 5.
   - Depois de **3 reprovações**, o planejador para, marca a issue com `ready-for-human` e avisa o orquestrador.
5. **PR e esteira.** O revisor abre o PR para o `develop` (título em português, corpo com `Closes #<nº>`, o que foi feito e como validar), ativa o auto-merge (`gh pr merge --auto --squash --delete-branch`) e acompanha a CI (`gh pr checks --watch`).
6. **Falhas na esteira.** O revisor é responsável por resolver:
   - **check falhando:** lê o log (`gh run view --log-failed`), corrige, roda a suíte localmente e faz push;
   - **conflito com o `develop`:** faz `git rebase origin/develop` (ou merge, se o rebase ficar arriscado), resolve, roda a suíte e faz push com `--force-with-lease`;
   - mudanças de comportamento além de um ajuste pontual voltam para o passo 4 (implementador corrige, nova revisão).
7. **Fim.** O PR entra pelo auto-merge, a issue fecha pelo `Closes`, e o planejador avisa o orquestrador. A worktree pode ser removida.

## Regras

- Ninguém faz merge manual, contorna a CI ou desliga checks. Push direto no `develop` e no `main` é proibido.
- Segredos só no `.env`. Nada do Google é persistido além do `place_id` (ADR 0001).
- Mudanças de workflow do GitHub Actions não entram por auto-merge: o PR fica para o Guilherme.
- Decisão de produto ou arquitetura que não esteja nas specs: parar e perguntar no comentário da issue, com `needs-info`.
- Todo comentário e PR em português.
