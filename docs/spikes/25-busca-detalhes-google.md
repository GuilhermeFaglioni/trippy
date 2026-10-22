# Spike 25 — Busca de lugares e Detalhes do Google

## Fechamento T2b — 22/10/2026

A busca primária do Geoapify usa `format=json`, cujo contrato documentado retorna registros planos em `results[]`. O adaptador agora lê esses campos diretamente. A busca secundária continua lendo `FeatureCollection` em `features[].properties`; o fluxo e a consulta permanecem separados, sem mesclagem automática.

O parser exige identidade (`place_id`), nome, coordenadas finitas dentro dos limites e uma origem de dados identificável. Endereço, nome local e país seguem opcionais. A regressão foi reproduzida contra o parser anterior durante a execução inicial do T2b: os registros planos eram descartados; os testes direcionados atuais confirmam os dois formatos e o descarte de entradas inválidas.

As fixtures em `packages/adapters/src/places/fixtures/` são **sintéticas e derivadas da documentação**, não respostas coletadas da API. A proveniência e os formatos de referência estão registrados no README da pasta; não houve chamada à Geoapify nem uso de credenciais nesta validação.

## Verificações locais

- `corepack pnpm exec vitest run --project unit packages/adapters/src/places/geoapify.test.ts packages/places-spike/src/sample-25.test.ts` — 2 arquivos e 10 testes passaram.
- `corepack pnpm test` — 27 arquivos Vitest e 229 testes passaram; o script raiz parou ao tentar chamar `pnpm` diretamente para os testes mobile, pois esse executável não está no `PATH`.
- `corepack pnpm --filter @trippy/mobile test` — 32 suítes e 144 testes Jest passaram quando chamado via Corepack.
- `corepack pnpm lint` — passou.
- `corepack pnpm -r --parallel typecheck` — passou nos 10 workspaces. O script raiz `corepack pnpm typecheck` não funciona neste ambiente porque tenta executar `pnpm` diretamente; a operação recursiva equivalente passou.
- `corepack pnpm format:check` — falhou em 14 arquivos. `packages/adapters/src/places/geoapify.ts` já falhava no HEAD anterior à T2b; os outros arquivos listados também estão fora do formato exigido. Nenhum arquivo alheio ao escopo foi formatado nesta subtarefa.
- `git diff --check` — passou.
- Integração de banco não executada: Docker e `pg_isready` não estão disponíveis neste ambiente.

Ambiente: Node `v24.22.1`, Corepack/pnpm `12.6.0`.

## T4 — amostra independente

`packages/places-spike/data/amostra-25.json` contém 60 casos estruturados: 30 na China, 20 globais e 10 de endereço. A amostra marca 47 casos como `verified` e 13 como `unverified`; estes últimos são excluídos de `measuredSample25`. O teste `sample-25.test.ts` passou e verifica contagens, idiomas, referências independentes de OSM, datum/conversão e campos obrigatórios. Esta validação é estrutural: neste fechamento não reabri as fontes para revalidar cada rótulo nem medi resultados de fornecedores.

## T5 — pendente

Não foram feitas chamadas de medição a Geoapify ou Google. Continuam pendentes a avaliação top-1/top-5 por caso e segmento, o recorte de atrações essenciais da China, presença do candidato separada da escolha humana, ganho da segunda tentativa Places, endereço local do candidato escolhido e correspondência com Google. Também faltam chamadas/SKUs por toque, latência, erros e créditos reais conferidos nos painéis de faturamento. Portanto, T5 e a validação final do spike continuam abertos.
