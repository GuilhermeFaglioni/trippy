# Spike de fotos no MinIO — issue #22

Data: 21/10/2026 · Escopo: subtarefa 2, implementação mobile. · Branch: `GuilhermeFaglioni/w22-mobile`.

## Implementação

- Tela acessível de fotos da viagem, aberta pelo cartão da viagem. Mostra fila local, estado de envio, ação de retry e aviso quando a API não responde. Fotos iniciam como `Sem lugar`; associação de lugar e álbum completo ficam fora do spike.
- Fila durável em SQLite, particionada por `user_id`, com UUID estável por foto. A fila retoma ao abrir a tela, voltar ao app e recuperar conexão. Drenagens concorrentes da mesma viagem são serializadas.
- Original copiado para armazenamento privado antes de qualquer transformação. EXIF do original é normalizado antes da conversão; JPEG de envio limita a maior dimensão a 2048 px, sem ampliar imagens menores.
- `takenTz` só vem de offset explícito no EXIF. Data sem offset não ganha fuso inferido; GPS ausente ou inválido vira `null`.
- Cliente usa os endpoints publicados: reserva com UUID local, PUT direto na URL assinada, confirmação idempotente e listagem. Falha entre PUT e confirmação retoma pela confirmação com o mesmo UUID; URL expirada é renovada sem trocar o UUID.

## Fixtures e Simulator

O script `scripts/photos-spike/generate-fixtures.swift` gera imagens sintéticas, em formatos HEIC/JPEG válidos e com tags EXIF reais via ImageIO. Todas medem 2560 × 1700 px.

| Arquivo | EXIF/GPS | SHA-256 |
| --- | --- | --- |
| `heic-beijing-offset-gps.heic` | 20/10/2026 08:12:03, offset `+08:00`, GPS | `f96fa91cfe4ecb209194032a0ee00173f9abd1019314f32809b8c64339b64297` |
| `jpeg-paraty-offset-gps.jpg` | 19/10/2026 20:45:10, offset `-03:00`, GPS | `d29e95404c4d8bf7b7631930c39f08af4191aa3dfe691bf9aa1a1f06a023bfdb` |
| `jpeg-tokyo-no-offset.jpg` | 18/10/2026 14:20:00, sem offset, GPS | `72915e18f2cb6d5cd15f8f76bd5a3f3f376f59661f8e3c2e1f1d6e908ee7ef7c` |
| `jpeg-no-exif.jpg` | sem tags EXIF/GPS | `e8436a77bac9587b024da6a8a587de6d71ac492c7545e2c728df8e6724e98a03` |
| `heic-no-exif.heic` | sem tags EXIF/GPS | `e5d78832408df4b87b366755b6536dad1465962d683abfa5f4c22ac1a1737614` |

Os cinco arquivos foram adicionados ao iPhone 16 Pro Simulator (`9DC6316A-F27C-41D2-B1AA-99B3E418E262`) com `xcrun simctl addmedia`; nenhum dado do Simulator foi apagado. `file`, `sips` e ImageIO confirmaram formatos, dimensões e tags.

## Evidência real

- Build e instalação iOS passaram com `pnpm exec expo run:ios --device 9DC6316A-F27C-41D2-B1AA-99B3E418E262`, usando Node 22.22.3. Bundle: `app.trippy.mobile`; Metro: porta `8081`.
- App abriu no Simulator e carregou a tela real `Viagem de teste` por rota, com layout e aviso de API indisponível. A compilação teve 0 erros e 1 warning do autolinking Expo sobre `CoreModule` interno.
- API integrada responde `GET http://localhost:3022/health` com `status: ok` e Postgres, storage, fila e SMTP saudáveis. `EXPO_PUBLIC_API_URL` está ausente no `.env` mobile, então o fallback do app é `http://localhost:3000`; o primeiro bundle mostrou falha de conexão nessa porta. Reiniciei Metro com `EXPO_PUBLIC_API_URL=http://localhost:3022`, mas não confirmei acesso da app Simulator à API.
- A suíte automatizada cobre normalização de EXIF, contrato HTTP, preparação/cópia do original, fila isolada por usuário, retomada, retry e serialização. Ela não substitui seleção real de imagens.

## Pendente

- Seleção real de HEIC/JPEG no seletor iOS e confirmação do EXIF retornado pelo `ImagePicker` não foram verificadas. A janela do Device Hub não expôs árvore de acessibilidade ao Orca; o CLI `elyra` não está instalado neste ambiente. A tela de fotos foi aberta, mas não foi possível tocar no botão do seletor.
- Mesmo com a API integrada saudável em `localhost:3022`, o app não foi conectado a essa porta nesta execução. Fluxo ponta a ponta de reserva, PUT, confirmação, retomada após encerramento e sincronização com MinIO permanece pendente.
- Relatório não afirma EXIF lido pelo picker no aparelho: somente geração e inspeção dos fixtures, parser unitário e tela real foram confirmados.

## Validação automatizada

- `pnpm test`: 19 arquivos/163 testes unitários e 25 suítes/117 testes mobile passaram.
- `pnpm test:integration`: 11 arquivos/24 testes passaram com `DATABASE_URL` do `.env` (banco `trippy_w22_mobile`) e chave EC P-256 efêmera de teste; nenhum segredo foi gravado no repositório. A primeira execução sem `AUTH_CODE_SECRET` falhou na configuração; a execução com variáveis temporárias passou.
- `pnpm typecheck`: passou em todos os pacotes.
- `pnpm lint`: passou após corrigir `prefer-const` no provider da fila.
- `pnpm format:check`: passou.

Avisos não bloqueantes observados: configuração Vitest informa sintaxe CommonJS/ESM incompatível com o futuro `configLoader: 'native'`; Watchman fez recrawl uma vez. O ambiente não recebeu alterações no `.env`; `pnpm-lock.yaml` não deve entrar no commit.
