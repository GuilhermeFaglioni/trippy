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

**Decisão do spike:** manter cópia permanente, metadados separados do JPEG e fila SQLite com UUID estável. A implementação retoma com o app aberto ou quando ele volta à execução. Este spike não implementa um serviço nativo de transferência em segundo plano nem comprova envio enquanto o processo está suspenso ou encerrado à força. No Simulator, o lote selecionado chegou ao backend e reapareceu após reabrir. A regressão automatizada agora cobre reconexão antes de o PUT interrompido rejeitar, preservação do UUID e ausência de PUTs simultâneos; ainda falta confirmar esse cenário real no Simulator, assim como encerrar o app com itens pendentes e reabri-lo. Validar execução em segundo plano em iPhone físico antes de assumir qualquer garantia de produto.

Validação da combinação após rebase, antes da correção da revisão 2: lint, formatação e typecheck passaram; 206 testes Vitest e 136 Jest passaram. A suíte de integração teve dois timeouts de 5s sob concorrência local; a repetição com `pnpm exec vitest run --project integration --maxWorkers=1` passou com 17 arquivos e 42 testes, sem mudar timeouts ou expectativas.

Data: 21/10/2026 · Escopo: subtarefa 2, implementação mobile. · Branch: `GuilhermeFaglioni/w22-mobile`.

## Implementação

- Tela acessível de fotos da viagem, aberta pelo cartão da viagem. Mostra fila local, estado de envio, ação de retry e aviso quando a API não responde. Fotos iniciam como `Sem lugar`; associação de lugar e álbum completo ficam fora do spike.
- Fila durável em SQLite, particionada por `user_id`, com UUID estável por foto. A implementação retoma o envio ao abrir a tela, voltar ao app e recuperar conexão. Drenagens concorrentes da mesma viagem são serializadas.
- A sessão observa eventos do Expo Network por uma assinatura nativa única durante a vida do módulo; sair da sessão remove apenas o consumidor JS. A drenagem não faz uma segunda consulta assíncrona de rede que possa vetar o evento recebido. Logs `[photo-sync]` registram eventos de conectividade e fases da drenagem sem IDs, URLs ou erros brutos.
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
- Depois do ensaio, o coordenador confirmou por consulta somente leitura em `trippy_w22_rebase` cinco fotos `uploaded` para essa viagem: Pequim `2026-10-20T08:12:03` / `+08:00` / `39.9042, 116.4074`; Paraty `2026-10-19T20:45:10` / `-03:00` / `-23.2237, -44.7192`; Tóquio `2026-10-18T14:20:00` / sem fuso / `35.6762, 139.6503`; duas sem EXIF com todos os campos nulos. O coordenador também confirmou leitura dos cinco objetos MinIO e validação via sharp como JPEG 2048 × 1360 (~84 KB), além de cinco mensagens publicadas na outbox e encaminhadas às filas exclusivas `trippy-w22-*`. A verificação de processamento posterior registrada no início deste relatório confirmou status `ready` e as cinco miniaturas; não foi repetida nesta revisão mobile.

## Pendente

- A causa da ausência de drenagem na reconexão relatada na validação anterior não foi determinada. A assinatura nativa única e a remoção da segunda leitura são correções preventivas de riscos observados no código, não prova da causa; a revalidação no Simulator macOS continua necessária.
- O estado `Enviada` após reabertura aparece nos cinco rótulos acessíveis capturados. O fluxo Maestro falhou apenas na asserção por texto isolado `Enviada`, que buscava um elemento separado; não foi repetido.
- O teste automatizado cobre reconexão com PUT ativo, UUID local preservado e no máximo um PUT simultâneo. Ainda não há ensaio manual de queda de rede durante o PUT nem de encerramento forçado com itens pendentes seguido de reabertura e envio.
- Upload enquanto o app está suspenso/em segundo plano não foi testado no Simulator e não é uma garantia deste spike.
- O ensaio criou a viagem `093a2a83-842a-49f6-adf7-6bf4b10e13e6`; os dados de teste não foram apagados.

## Validação automatizada

### Revisão 2 — commit `a2c3d4cb99e5e1736031b09d07ae4916139857d2`

- Antes do fechamento desta revisão, a execução de `pnpm test` reportou 206 testes Vitest e 142 Jest aprovados (348 no total). Ela incluiu as regressões de reconexão durante PUT, foto adicionada durante drenagem, UUID estável e serialização; a suíte não foi repetida no fechamento.
- `corepack pnpm lint`: passou neste fechamento.
- `corepack pnpm format:check`: passou neste fechamento; Prettier confirmou todos os arquivos.
- `corepack pnpm typecheck` não encontrou o executável `pnpm` ao rodar o script raiz. O comando equivalente do script, `corepack pnpm -r --parallel typecheck`, passou nos 11 workspaces: apps/api, apps/mobile, apps/worker-render, apps/worker-thumbs, packages/adapters, packages/db, packages/dev-env, packages/domain, packages/google-maps-links, packages/places-spike e packages/sync.
- A suíte de integração e checks combinados do rebase foram reportados como verdes anteriormente (42 testes de integração; 206 Vitest e 136 Jest naquela revisão). Não foram repetidos neste fechamento.

O workspace estava limpo antes da atualização deste relatório, no HEAD `a2c3d4c`; o `.env` e `pnpm-lock.yaml` não foram alterados. Não há execução de Simulator neste fechamento.

### Correção F1/F2 — implementação local sobre `3795690`

- `corepack pnpm lint`, `corepack pnpm format:check` e `git diff --check`: passaram.
- `corepack pnpm typecheck`: passou nos 11 workspaces. Como o script chama `pnpm` internamente e esse binário não estava no `PATH`, usei um wrapper temporário fora do repo que delegou ao Corepack 12.6.0.
- `corepack pnpm test`: 24 arquivos e 206 testes Vitest, mais 37 suítes e 144 testes Jest, passaram com o mesmo wrapper temporário.
- Integração não executada: o ambiente tem Docker, mas `docker compose` não está instalado (`docker: unknown command`) e `pg_isready` não está disponível; não confirmei uma instância de Postgres local. Simulator/iPhone não executado neste Linux; a revalidação real da reconexão e os cenários do roteiro seguem pendentes no macOS.

## Roteiro manual pendente — Simulator iOS

O ensaio tem duas ferramentas independentes: um proxy reverso controlável para segurar/derrubar o PUT para MinIO e um controle que gere eventos de conectividade observáveis pelo Simulator. Não trate Wi-Fi desligado no Mac como falha do PUT: o app acessa `localhost`, que continua alcançável. O Wi-Fi do Mac pode ser usado apenas como estímulo de conectividade se os logs do app confirmarem os eventos.

Antes de cada cenário, use a mesma viagem e o mesmo usuário, confirme que a foto de teste ainda não está na lista remota e registre o UUID local. Configure o endpoint assinado para atravessar o proxy (por exemplo, a API assina `http://localhost:59001` e o proxy encaminha ao MinIO em `localhost:59000`). O proxy deve preservar o `Host` e o caminho usados na assinatura; não reescreva a URL depois que a API a assinar. Habilite uma regra que segure um PUT e permita encerrá-lo com reset/erro sob comando. Os logs do proxy devem omitir query string, assinatura, headers de autorização e corpo da requisição; registre só sequência, método, estado (segurado, liberado, resetado), horário e concorrência máxima.

Abra os logs do app pelo Console do Xcode filtrando `[photo-sync]`. Eles registram somente origem e fases da drenagem e os booleanos de conectividade, sem ID de usuário, viagem, foto, URL ou erro bruto. Para cada transição, salve a sequência de linhas `network event`, `drain requested`, `drain started` e `drain completed`/`drain failed`, com horário.

### PUT interrompido com reconexão antes da falha (corrida F1)

1. Com a conexão ativa, abra **Fotos da viagem**, selecione uma foto e aguarde o proxy registrar e segurar o primeiro PUT.
2. Gere no Simulator uma transição para desconectado e depois conectado sem fechar o app. Confirme nos logs `[photo-sync]` o evento `connected=false` seguido de `connected=true` e `drain requested source=network`. Se o controle escolhido não produzir os eventos no app, registre o ensaio como inconclusivo; não suponha que mudar o Wi-Fi do Mac basta.
3. Só depois do pedido de drenagem causado pela reconexão, ordene ao proxy que resete o primeiro PUT, para que o PUT antigo rejeite depois da nova drenagem já ter sido pedida.
4. Confirme no proxy que apareceu um segundo PUT após o reset, que os PUTs nunca se sobrepuseram e que a reserva/complete usou o mesmo UUID local. Aguarde a fila chegar a `Enviada` sem tocar em retry.
5. Consulte o backend e MinIO: deve existir exatamente um registro e um par original/miniatura correspondente. Atualize ou reabra a tela apenas para confirmar a apresentação; isso não conta como acionamento do retry.

### Falha comum de PUT e recuperação

1. Repita a preparação e segure o PUT. Mantenha a conectividade do app inalterada e mande o proxy resetar a conexão.
2. Confirme no proxy que o PUT falhou e observe o estado pendente/erro na fila local.
3. Gere uma transição de conectividade no Simulator, confirme o evento `connected=true` e `drain requested source=network`, sem usar retry manual.
4. Confirme um novo PUT com o mesmo UUID, uma única foto no backend e concorrência máxima de um PUT.

### Encerramento com item pendente e reabertura

1. Desconecte a rede no Simulator, abra **Fotos da viagem**, selecione uma foto e confirme que ela aparece na fila local como pendente.
2. Force o encerramento do app pelo seletor de apps do iOS; não use apenas reload do Metro.
3. Restaure a rede, reabra o app, entre na mesma viagem e abra **Fotos da viagem**.
4. Aguarde a retomada automática e confirme `Enviada` e uma única foto correspondente no backend.

Esses cenários seguem pendentes até execução e registro no Simulator. Grave os logs do app sanitizados e o relatório do proxy junto com a evidência do backend. O plano desta correção está publicado em [comentário da issue #22](https://github.com/GuilhermeFaglioni/trippy/issues/22#issuecomment-6341010017); o plano da revisão 2 está no [comentário anterior](https://github.com/GuilhermeFaglioni/trippy/issues/22#issuecomment-6329869402).
