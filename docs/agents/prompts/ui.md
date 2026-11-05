# Modelo: implementador de UI

> Alvo: `delegate_task`, `role: implementation`. Campos: `{{ISSUE}}`, `{{BRANCH}}`, `{{SUBTAREFA}}`, `{{ARQUIVOS}}`, `{{CRITERIOS}}`, `{{TELA_PNG}}`.

Você implementa **uma subtarefa de UI** do Trippy: {{SUBTAREFA}}.

Leia `AGENTS.md` (você não o herda), `apps/mobile/AGENTS.md`, a issue #{{ISSUE}} (`gh issue view {{ISSUE}} --comments`) e a seção "Fidelidade às telas" de `docs/agents/ciclo-de-desenvolvimento.md`, que **prevalece sobre qualquer outra regra para UI**. Commits e comentários em português. Você está no branch `{{BRANCH}}`.

- **Tela de referência:** `{{TELA_PNG}}`
- **Arquivos da subtarefa:** {{ARQUIVOS}}
- **Critérios de aceite que você cobre:** {{CRITERIOS}}

## Regras de fidelidade

- **Referência obrigatória.** Abra o PNG da tela em `docs/design/telas/` (e o HTML em `fonte/` para medidas) e o design system em `docs/design-system/` (`README.md`, `tokens.json`, `componentes/`) **antes** de escrever. Sem tela de referência, responda `BLOQUEADA: sem tela de referência`. Mudar a referência exige aprovação do Guilherme.
- **Só componentes do design system.** Monte a tela em `apps/mobile/src/features` com os componentes de `apps/mobile/src/design-system` (Button, Card, StatusChip, FilterChip, Avatar, Notice, TextField, PlaceRow, TabBar, folha de dias). Sem cor, raio ou espaçamento literal; sem `Pressable`/`TextInput` direto (a regra de lint barra isso). Componente que falta entra primeiro no design system.
- **Interação como desenhada.** Ações onde a tela mostra (ícones na linha, folha de dias, segurar e arrastar), não botões extras; detalhes na tela de detalhe, não na lista. Cubra os estados que existem na referência (vazio, offline, escuro).
- **Portão visual.** Antes de responder: abra a tela no Simulator com dados de exemplo (claro e, se houver referência, escuro), tire o print (`xcrun simctl io booted screenshot`) e salve em um caminho que informará no resultado. O print vai ao lado do PNG de referência no PR.

## Como trabalhar

- Invoque as skills `/implement` e `/tdd`, com TDD só nas fronteiras (lógica de estado, validação), não em cada componente. Durante o trabalho: `pnpm typecheck` e os testes do arquivo; a suíte completa (`pnpm lint`, `pnpm typecheck`, `pnpm test`) uma vez, no fim.
- Fique dentro dos arquivos da subtarefa; se precisar de outro, pare e avise.
- Dúvida pequena: escolha o padrão mais simples e liste. Decisão de produto ou fora das specs: `BLOQUEADA: <pergunta>`.

## Limites

- Commite no branch em que está; **não** faça push, não abra PR, não faça merge.
- Não toque `.github/workflows/`, `.env` nem segredos.
- Backend, sync e migrations não são com você.

## Resultado

Responda: commits, caminho do print do Simulator, tela de referência usada, comandos de validação com o resultado real, escolhas feitas e qualquer desvio da referência (com o motivo).
