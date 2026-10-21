# Spike 23 — sincronização offline de lugares

**Execução:** 21/out/2026

**Escopo:** convergência de lugares, visitas e membros entre dois clientes SQLite e Postgres, incluindo reenvio idempotente, remoção e retomada após encerramento do app.

## Hipótese

Um cliente pode registrar operações no SQLite enquanto está sem transporte, fechar e reabrir o app sem perder o outbox, e convergir com outro cliente e o servidor quando a conexão voltar. Reenvios do mesmo lote não devem duplicar dados, e paginação precisa continuar correta com limite pequeno.

## O que foi construído

- Teste de integração com dois clientes reais de `@trippy/sync`, cada um usando arquivo `node:sqlite` próprio, contra as rotas Hono em `app.fetch` e um Postgres descartável.
- Necessidade de reconciliação por `duplicate` ou `not_sent` persistida atomicamente em `sync_state`; bootstrap parcial retoma pelo `snapshot_seq` após falha ou reabertura.
- Cenário de viagem e convite, aceite do membro, escrita offline de lugar e visita, fechamento e reabertura do mesmo SQLite, perda de resposta de push e reenvio do mesmo lote.
- Verificação de remoção propagada de B para A, escritas offline simultâneas dos dois membros, cursor de pull com limite 1 e igualdade de `canonicalTripState` em A, B e Postgres.
- Roteiro Maestro e script `scripts/sync-dois-simuladores.sh` que instala o mesmo development build em dois Simulators, dirige os dois usuários via Mailpit, confere que o lugar não chegou ao Postgres antes da reconexão e compara os estados canônicos no final.

## Evidência

Teste de integração:

```text
pnpm exec vitest run --project integration apps/api/test/sync-convergencia.int.test.ts
1 arquivo, 1 teste aprovado.
```

Execução real do roteiro em 21/out/2026:

```sh
./scripts/sync-dois-simuladores.sh \
  763AA0F0-544B-4C7B-9B9E-CCF00993978F \
  FF614D07-D4B5-40F9-8E67-8C5C786FB41B
```

O run usou API em `localhost:4300` e Metro na porta `4400`. A tentou sincronizar enquanto offline, recebeu falha de transporte e manteve as duas operações pendentes. Após reabrir, o SQLite manteve o lugar e “Eu fui ✓”. O Postgres ainda tinha zero lugares antes da reconexão. A reconectou e B sincronizou.

```text
Estados canônicos iguais: 1 lugares, 1 visitas, 2 membros.
[sync-dois-simuladores] Convergência confirmada entre SQLite A, SQLite B e Postgres.
```

O script encerrou com código 0. A comparação leu os arquivos SQLite dentro de cada container do app e os registros do Postgres; não dependeu apenas das telas.

## Limitações

- O spike valida sincronização quando o app volta ao primeiro plano. Execução contínua e garantias de sync em segundo plano no iOS não foram validadas.
- Remoções usam tombstones; retenção, política de expurgo e recuperação de armazenamento ainda não foram definidas.
- O cenário exercita adições concorrentes. Reordenação e conflitos concorrentes de edição do roteiro estão fora deste spike.
- O toggle “Simular sem internet” valida a fronteira de transporte do app no Simulator; não substitui teste em aparelho físico com conectividade móvel real.

## Decisão

Hipótese confirmada para o fluxo exercitado: SQLite e outbox preservam escritas durante fechamento do app, o reenvio é idempotente e os dois membros convergem com Postgres após reconexão. Manter o sync como mecanismo de consistência eventual e tratar garantias de segundo plano, retenção de tombstones e conflitos de edição como decisões separadas.
