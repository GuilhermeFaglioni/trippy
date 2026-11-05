# Spike 24 — conflito no roteiro e membro removido

> **Nota:** este registro cita Maestro e scripts de dois Simulators que foram removidos do repositório. Os testes ponta a ponta agora são feitos à mão por um agente; veja "Testes ponta a ponta à mão" em [`desenvolvimento-local.md`](../desenvolvimento-local.md).

**Escopo:** conflito de versão em `itinerary.arrange`, gestão de membros pelo sync (`member.remove`, `member.set_role`) e comportamento do cliente removido. O código entrou no #57; o sair do grupo, no #101.

## Hipótese

Dois organizadores que reordenam o mesmo dia offline convergem sem perda: o servidor aceita o primeiro, recusa o segundo por versão antiga, e o app do segundo guarda o rascunho e mostra o roteiro atual. Um membro removido tem as escritas recusadas e as pendências ficam como não enviadas.

## Cobertura por critério de aceite

| Critério | Onde está testado |
|---|---|
| Comparação e incremento atômicos | `apps/api/test/sync-roteiro.int.test.ts` ("aplica um único arrange concorrente…"): duas conexões, um `applied`, um `conflict`, versão +1 uma vez |
| Versão antiga volta como conflito, sem sobrescrever | idem; o reenvio do mesmo `op_id` devolve o mesmo conflito |
| Rascunho preservado e roteiro atual exibido | `packages/sync/src/client/sync-client.test.ts` (rascunho sobrevive à reabertura do SQLite), `itinerary-screen.test.tsx`, `apps/api/test/roteiro-conflito.int.test.ts` (dois clientes reais + Postgres) |
| Membro comum não muda o roteiro | `sync-roteiro.int.test.ts` ("rejeita membro comum…") e `packages/domain/src/roles.test.ts` |
| Removido: push recusado, pendências marcadas, viagem some | `sync-membros.int.test.ts`, `roteiro-conflito.int.test.ts`, `sync-client.test.ts`, `my-trips-screen.test.tsx` |
| Cenário automatizado com os dois Simulators | `scripts/roteiro-dois-simuladores.sh` + `.maestro/roteiro/` — **ainda sem execução verde registrada** (veja abaixo) |

## Evidência

```text
pnpm exec vitest run --project integration apps/api/test/sync-roteiro.int.test.ts \
  apps/api/test/sync-membros.int.test.ts apps/api/test/roteiro-conflito.int.test.ts
3 arquivos, 8 testes aprovados (2/nov/2026, sobre o develop em 2abc395).
```

## Pendente

- A execução do script nos dois Simulators não foi registrada como verde. O commit do #57 diz que o cenário "ainda não passou", e as telas mudaram muito desde então (sprint 3). Os fluxos Maestro estão sendo atualizados na #68 (E2E da sprint); ao rodar o script verde lá, colar a saída final nesta seção.
- Nenhuma validação em aparelho físico.

## Decisão

Lógica de conflito, permissões e remoção confirmadas pelos testes de integração e de cliente. O critério do Simulator fecha com a #68.
