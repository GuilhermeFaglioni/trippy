# Spike de fotos no MinIO — issue #22

## Integração final verificada pelo planejador

Após integrar a #23, fotos usa `0006_photos.sql`, preservando `0005_sync_lugares_convites.sql`. Um banco novo, `trippy_w22_rebase`, aplicou 0001–0006. A tela de lugares da viagem continua disponível; a ação **Fotos da viagem** abre `/trips/[id]/photos`.

Na viagem de ensaio `093a2a83-842a-49f6-adf7-6bf4b10e13e6`, a consulta direta ao Postgres confirmou exatamente cinco fotos. Os metadados recebidos pelo app e persistidos pela API correspondem às fixtures:

| Fixture | Horário original | Fuso | Latitude / longitude |
| --- | --- | --- | --- |
| HEIC Pequim | `2026-10-20T08:12:03` | `+08:00` | `39.9042 / 116.4074` |
| JPEG Paraty | `2026-10-19T20:45:10` | `-03:00` | `-23.2237 / -44.7192` |
| JPEG Tóquio sem offset | `2026-10-18T14:20:00` | `null` | `35.6762 / 139.6503` |
| HEIC e JPEG sem EXIF | `null` | `null` | `null / null` |

O planejador leu os cinco objetos diretamente do MinIO e os decodificou com `sharp`: todos são JPEG de 2048 × 1360 px, entre 83.966 e 84.479 bytes. O worker publicou cinco mensagens da outbox e processou cada uma na fila exclusiva `trippy-w22-thumbs`. Depois, o banco mostrou cinco fotos `ready`; os cinco objetos `thumb.jpg` foram lidos e decodificados como JPEG de 512 × 340 px. Os testes de integração cobrem repetição de mensagem, falha após cópia, retry e DLQ; esses cenários não foram todos reproduzidos manualmente no lote do Simulator.

**Decisão do spike:** manter cópia permanente, metadados separados do JPEG e fila SQLite com UUID estável. A implementação retoma com o app aberto ou quando ele volta à execução. Este spike não implementa um serviço nativo de transferência em segundo plano nem comprova envio enquanto o processo está suspenso ou encerrado à força. No Simulator, o lote selecionado chegou ao backend e reapareceu após reabrir; encerramento com itens ainda pendentes e queda de rede durante o PUT continuam sem ensaio manual, embora as fronteiras de retry e persistência estejam cobertas por testes automatizados. Validar execução em segundo plano em iPhone físico antes de assumir qualquer garantia de produto.

Validação da combinação após rebase: lint, formatação e typecheck passaram; 206 testes Vitest e 136 Jest passaram. A suíte de integração teve dois timeouts de 5s sob concorrência local; a repetição com `pnpm exec vitest run --project integration --maxWorkers=1` passou com 17 arquivos e 42 testes, sem mudar timeouts ou expectativas.

Data: 21/10/2026 · Escopo: subtarefa 2, implementação mobile. · Branch: `GuilhermeFaglioni/w22-mobile`.

## Implementação

- Tela acessível de fotos da viagem, aberta pelo cartão da viagem. Mostra fila local, estado de envio, ação de retry e aviso quando a API não responde. Fotos iniciam como `Sem lugar`; associação de lugar e álbum completo ficam fora do spike.
- Fila durável em SQLite, particionada por `user_id`, com UUID estável por foto. A implementação retoma o envio ao abrir a tela, voltar ao app e recuperar conexão. Drenagens concorrentes da mesma viagem são serializadas.
- Original copiado para armazenamento privado antes de qualquer transformação. EXIF do original é normalizado antes da conversão; JPEG de envio limita a maior dimensão a 2048 px, sem ampliar imagens menores.
- `takenTz` só vem de offset explícito no EXIF. Data sem offset não ganha fuso inferido; GPS ausente ou inválido vira `null`.
- Cliente usa os endpoints publicados: reserva com UUID local, PUT direto na URL assinada, confirmação idempotente e listagem. Falha entre PUT e confirmação retoma pela confirmação com o mesmo UUID; URL expirada é renovada sem trocar o UUID.
- Fotos remotas usam `thumbnailUrl` retornada pelo servidor; respostas sem esse campo continuam aceitas e exibem metadados e estado.

## Fixtures e Simulator

O script `scripts/photos-spike/generate-fixtures.swift` gera imagens sintéticas, em formatos HEIC/JPEG válidos e com tags EXIF reais via ImageIO. Todas medem 2560 × 1700 px.

| Arquivo | EXIF/GPS | SHA-256 |
| --- | --- | --- |
| `heic-beijing-offset-gps.heic` | 20/10/2026 08:12:03, offset `+08:00`, GPS | `c648dd39fa1e36883fe13b2d6db4d6626a2d82681b531378ade2f04a21d8006b` |
| `jpeg-paraty-offset-gps.jpg` | 19/10/2026 20:45:10, offset `-03:00`, GPS | `d29e95404c4d8bf7b7631930c39f08af4191aa3dfe691bf9aa1a1f06a023bfdb` |
| `jpeg-tokyo-no-offset.jpg` | 18/10/2026 14:20:00, sem offset, GPS | `72915e18f2cb6d5cd15f8f76bd5a3f3f376f59661f8e3c2e1f1d6e908ee7ef7c` |
| `jpeg-no-exif.jpg` | sem tags EXIF/GPS | `e8436a77bac9587b024da6a8a587de6d71ac492c7545e2c728df8e6724e98a03` |
| `heic-no-exif.heic` | sem tags EXIF/GPS | `e5d78832408df4b87b366755b6536dad1465962d683abfa5f4c22ac1a1737614` |

Os cinco arquivos foram adicionados com `xcrun simctl addmedia` ao Simulator `Maestro_IOS_iPhone-16-Pro_18` (`098C1E12-701D-4A2E-A487-2E18F11FB0D7`). Nenhum dado de Simulator foi apagado. `file`, `sips` e ImageIO confirmaram formatos, dimensões e tags.

## Evidência real

- Build, instalação e abertura passaram com `cd apps/mobile && PATH="/Users/guilhermefaglioni/.nvm/versions/node/v22.22.3/bin:$PATH" pnpm exec expo run:ios --device 098C1E12-701D-4A2E-A487-2E18F11FB0D7`. Bundle: `app.trippy.mobile`; Metro: porta `8081`; API configurada no Metro: `http://localhost:3022`. Build teve 0 erros e 1 warning do autolinking Expo sobre `CoreModule` interno.
- No seletor real do iOS, foram selecionadas cinco fixtures importadas: HEIC e JPEG com offsets EXIF distintos, JPEG com GPS sem offset e HEIC/JPEG sem EXIF. A tela exibiu `5 fotos`; após envio, linhas exibiam `Enviada`.
- O fluxo Maestro parou e reabriu o app com `clearState: false`, abriu a mesma viagem (`093a2a83-842a-49f6-adf7-6bf4b10e13e6`) e confirmou a tela e `5 fotos`. A hierarquia capturada contém cinco rótulos `Foto da viagem. Sem lugar. Enviada.`. O fluxo Maestro terminou com falha na asserção de texto isolado `Enviada`; esse texto compõe o rótulo acessível completo de cada foto e não aparece como elemento textual separado.
- A viagem de ensaio foi criada na API em `localhost:3022`.
- Depois do ensaio, o coordenador confirmou por consulta somente leitura em `trippy_w22_rebase` cinco fotos `uploaded` para essa viagem: Pequim `2026-10-20T08:12:03` / `+08:00` / `39.9042, 116.4074`; Paraty `2026-10-19T20:45:10` / `-03:00` / `-23.2237, -44.7192`; Tóquio `2026-10-18T14:20:00` / sem fuso / `35.6762, 139.6503`; duas sem EXIF com todos os campos nulos. O coordenador também confirmou leitura dos cinco objetos MinIO e conversão via sharp para JPEG 2048 × 1360 (~84 KB), além de cinco mensagens publicadas na outbox e processamento nas filas exclusivas `trippy-w22-*`.

## Pendente

- A verificação dos metadados persistidos foi feita pelo coordenador no banco/MinIO, não por consulta direta deste worker.
- O estado `Enviada` após reabertura está presente nos cinco rótulos acessíveis capturados; a asserção Maestro por texto exato `Enviada` falhou porque buscava elemento separado. Não foi repetido o ensaio.
- Não foi confirmado se uma tentativa interrompida e repetida mantém o mesmo UUID sem criar duplicatas. A validação combinada pós-rebase do pai foi reportada pelo coordenador como verde.
- Não foi simulado encerramento do app com itens ainda pendentes nem queda de rede durante envio; reabrir com cinco fotos enviadas não comprova retomada de fila pendente nem ausência de duplicatas após retry.
- Upload enquanto o app está em segundo plano não foi testado no Simulator.
- O ensaio criou viagem ID `093a2a83-842a-49f6-adf7-6bf4b10e13e6`; dados de teste não foram apagados.

## Validação automatizada

- `pnpm test`: 19 arquivos/163 testes Vitest e 25 suítes/118 testes Jest passaram (281 no total).
- `pnpm test:integration`: 11 arquivos/24 testes passaram com `DATABASE_URL` do `.env` (banco `trippy_w22_mobile`) e chave EC P-256 efêmera de teste; nenhum segredo foi gravado no repositório. A primeira execução sem `AUTH_CODE_SECRET` falhou na configuração; a execução com variáveis temporárias passou.
- `pnpm typecheck`: passou em todos os pacotes.
- `pnpm lint`: passou após corrigir `prefer-const` no provider da fila.
- `pnpm format:check`: passou.

O coordenador reportou também a suíte combinada do pai pós-rebase verde: 206 Vitest, 136 Jest e 42 testes de integração. Avisos não bloqueantes nesta execução: configuração Vitest informa sintaxe CommonJS/ESM incompatível com o futuro `configLoader: 'native'`; Watchman fez recrawl uma vez. O `.env` não foi alterado; `pnpm-lock.yaml` não deve entrar no commit.
