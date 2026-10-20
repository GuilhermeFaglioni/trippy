# Spike Remotion — issue #19

## Resultado

Ensaio executado em 20/out/2026 com worker isolado em Docker `linux/amd64`. Imagem confirmou a fonte `Noto Sans CJK SC`; quatro arquivos MP4 foram renderizados e validados no MinIO: dois cenários (com e sem fotos), cada um com variante limpa e com marca d'água.

Todos os arquivos têm 540 × 960 px, H.264 e duração de 30,059 s. `ffprobe` confirmou dimensões, codec e duração. Quadros dos dois cenários foram extraídos e inspecionados; a composição sem fotos usa lugares e caracteres CJK, e a composição com foto inclui a imagem fixture.

## Ambiente e fixture

- Imagem: `trippy-worker-render:spike19`, plataforma observada `linux/amd64`.
- Fonte verificada dentro da imagem por `fc-match`: `Noto Sans CJK SC`.
- Serviços: Postgres 17, ElasticMQ 1.6.16 e MinIO locais.
- Execução: `04784f22-e414-40bf-8e25-e8ec53515a97`.
- Fila isolada: `trippy-spike19-04784f22e414`.
- Bucket de fotos isolado foi removido após o ensaio. O banco e a fila isolados também foram removidos.
- Bucket de vídeos mantido para inspeção: `trippy-spike19-v-04784f22e414` (quatro objetos MP4).
- Fixture: `apps/worker-render/fixtures/beijing-courtyard.png`, ilustração raster gerada localmente pelo script `apps/worker-render/fixtures/generate-courtyard.py`; sem fotografia ou recurso externo.

O dispatcher criou o worker em modo detached e retornou após 190 ms. Um worker foi interrompido deliberadamente; o job foi retomado com tentativa 2 e fencing token 2. O objeto publicado usa `fence-2.mp4`, demonstrando que a conclusão pertence à geração atual.

## Medições

`render (ms)` mede bundle Remotion e render. `CPU (ms)` é a diferença de `usage_usec` em `cpu.stat` do cgroup durante essa etapa. `Pico de memória (bytes)` vem de `memory.peak` do cgroup do container exclusivo do job, desde a criação do container. São contadores lidos do runtime real, não estimativas. Cada container teve limites de 2 CPUs, 4 GiB de memória e swap, 512 processos e 512 MiB de `/dev/shm`; nenhum render excedeu 2,24 GB de pico de memória.

| Cenário | Variante | Render (ms) | CPU (ms) | Pico de memória (bytes) | MP4 (bytes) |
| --- | --- | ---: | ---: | ---: | ---: |
| Sem fotos | Limpa | 61.919 | 93.275 | 1.820.336.128 | 2.517.167 |
| Sem fotos | Com marca d'água | 65.565 | 100.267 | 2.232.012.800 | 2.525.205 |
| Com foto | Limpa | 64.104 | 96.673 | 1.969.000.448 | 2.604.485 |
| Com foto | Com marca d'água | 61.379 | 91.586 | 1.832.460.288 | 2.607.795 |

## Objetos no MinIO

| Cenário / variante | Chave | SHA-256 |
| --- | --- | --- |
| Sem fotos / limpa | `recaps/291999ce-92a2-457b-85dc-bcb5267e615a/v1/clean/fence-2.mp4` | `9b340363d0b5a79d53784ad1dcc13645c9532bc0c6a9a3a686b473670ae80993` |
| Sem fotos / com marca d'água | `recaps/291999ce-92a2-457b-85dc-bcb5267e615a/v1/watermarked/fence-1.mp4` | `fc409b7b919170debb6282a1b2b646c9fe91e54e2b480384b64c04a7fad72568` |
| Com foto / limpa | `recaps/bb4120f1-263f-4036-96b9-d4cd8be8c747/v2/clean/fence-1.mp4` | `d54ea5ec4a6f2776c7ac5d693761ad2a9733d714b12fad0b426d356ee71cfe4f` |
| Com foto / com marca d'água | `recaps/bb4120f1-263f-4036-96b9-d4cd8be8c747/v2/watermarked/fence-1.mp4` | `e44def176ae50306db2b0faf073f388f4d6a4f8a89c9622eeace1c599eeda444` |

## Suíte automatizada

- `pnpm lint`: passou.
- `pnpm typecheck`: passou nos seis pacotes do workspace.
- `pnpm test`: 6 arquivos e 24 testes passaram.
- `pnpm test:integration`: 5 arquivos e 10 testes passaram. Foi executado com buckets e filas de integração exclusivos; esses recursos foram removidos após o teste.
- No teste de integração `publishes outbox jobs and starts one detached worker for duplicate messages`, duas mensagens iguais para o mesmo job produziram uma única chamada de `launchWorker`; a segunda chamada do dispatcher retornou `busy`, sem iniciar outro worker. O teste também verifica uma mensagem restante na fila e a rejeição do fencing token antigo após a recuperação.

Vitest exibiu aviso não bloqueante sobre `configLoader: 'native'` e sintaxe ESM em `vitest.config.ts` CommonJS.

## Repetição

Com os serviços locais descritos em `docs/desenvolvimento-local.md`, executar:

```sh
pnpm --filter @trippy/worker-render rehearse
```

O comando cria recursos com prefixo exclusivo `trippy-spike19`, compila e valida a imagem, interrompe um worker, espera a recuperação, valida os quatro MP4 com `ffprobe`, registra medições e remove banco, fila, bucket de fixture e arquivos temporários. Preserva apenas o bucket de vídeos da execução concluída.
