# Spike 18 — benchmark Geoapify

**Execução:** 19–20/out/2026
**Escopo:** amostra rotulada e benchmark real de Geocoding e Places. Os 20 links ficam pendentes da integração sequencial com `@trippy/google-maps-links`.

## Resultado

O relatório auditável por caso está em [`geoapify-final-2026-10-20.json`](../../packages/places-spike/results/geoapify-final-2026-10-20.json). Ele contém os rótulos esperados, fontes, tolerância, respostas, avaliação e resumo. Os relatórios brutos ficam preservados em `packages/places-spike/results/` para rastrear o teste de fumaça, a correção do parâmetro e a repetição de timeout.

| Grupo | Chamadas avaliadas | Acerto top-1 | Acerto top-5 | Endereço local completo | Coordenadas avaliáveis dentro da tolerância | Ausências | Duplicatas | Distância mediana / p95 | Latência mediana / p95 | Créditos estimados |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| China (15 Pequim, 15 Xangai) | 60 | 28/60 (46,7%) | 29/60 (48,3%) | 1/60 (1,7%) | 29/31 (93,5%) | 28 | 0 | 453,9 / 1.233,9 m | 464 / 4.561 ms | 60 |
| Global | 40 | 21/40 (52,5%) | 21/40 (52,5%) | 11/40 (27,5%) | 21/26 (80,8%) | 13 | 0 | 63,9 / 417,4 m | 652 / 2.372 ms | 40 |
| Endereços | 10 | 5/10 (50%) | 5/10 (50%) | 8/10 (80%) | 5/8 (62,5%) | 0 | 0 | 35,4 / 2.758,4 m | 1.644 / 22.951 ms | 10 |
| **Total** | **110** | **54/110 (49,1%)** | **55/110 (50%)** | **20/110 (18,2%)** | **55/65 (84,6%)** | **41** | **0** | **334,5 / 1.233,9 m** | **715 / 4.740 ms** | **110** |

`Top-5` examina os cinco primeiros candidatos e exige correspondência de identidade e coordenada dentro da tolerância. Um caso apareceu apenas no top-5: Geocoding de Da Dong Jinbao, no rank 3, a 896,1 m da referência; o resultado de rank 1 ficava a 1.916,4 m. Endereço completo significa que todos os tokens esperados aparecem no endereço do candidato correspondente; não significa igualdade de endereço postal completo. Distância é haversine entre coordenada retornada e referência rotulada, apenas nos candidatos correspondentes. A proporção dentro da tolerância usa candidatos correspondentes como denominador.

### Resultado por método

| Método | Chamadas | Acerto top-1 | Acerto top-5 | Ausências válidas | Endereço completo | Coordenadas avaliáveis dentro da tolerância | Distância mediana / p95 | Latência mediana / p95 | Créditos estimados |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Geocoding | 60 | 40/60 (66,7%) | 41/60 (68,3%) | 6 | 17/60 (28,3%) | 41/50 (82%) | 324,4 / 2.758,4 m | 1.791 / 5.284 ms | 60 |
| Places | 50 | 14/50 (28%) | 14/50 (28%) | 35 | 3/50 (6%) | 14/15 (93,3%) | 334,5 / 896,1 m | 387 / 668 ms | 50 |

Nos 50 POIs, Geocoding acertou top-1 em 20/30 casos da China (66,7%) e 15/20 globais (75%). Places acertou 8/30 casos da China (26,7%) e 6/20 globais (30%). Em pelo menos um dos dois resultados por caso, houve acerto top-1 em 21/30 casos chineses e 15/20 globais; essa união mede disponibilidade de um candidato, não uma estratégia final de mesclagem ou ordenação.

## Amostra e regra de avaliação

- 30 POIs na China: 15 em Pequim e 15 em Xangai, com atrações, hotéis, restaurantes e filiais; inclui nomes locais e aliases.
- 20 POIs globais, incluindo restaurantes menores.
- 10 endereços sem POI, em diferentes países e idiomas.
- 20 fixtures sintéticas de formatos variados de link do Google Maps. Fixtures não representam links reais resolvidos e não foram chamadas neste estágio. `targetCaseId` registra o rótulo conhecido nos links com nome ou coordenada; fica `null` nos links opacos ou de busca por lista sem destino único.
- Cada caso define nomes esperados, tokens do endereço, coordenada de referência, tolerância, fontes e `referencePrecision: unverified`. Esses rótulos foram codificados antes das chamadas Geoapify. A precisão da referência não foi confirmada; tolerância geográfica não deve ser lida como precisão conhecida.
- Tolerância padrão para POIs chineses: 1.000 m; POIs globais: 250 m. Endereços: 100 m, exceto Queen’s Road Central (150 m) e os dois endereços chineses (500 m). São limites operacionais desta avaliação, não garantias de acurácia.
- As fontes por item ficam no JSON. Há links de artigos da Wikipédia quando disponíveis e buscas do OpenStreetMap para todos os casos. As buscas OSM não são uma fonte independente para avaliar Places: a documentação declara OpenStreetMap como fonte dessa API. O relatório não preserva o campo `datasource` de cada resposta de Geocoding, então a origem específica desses candidatos não foi verificada. Parte das coordenadas não tem uma referência documental direta. Isso cria risco de circularidade e impede tratar os números como ground truth.

Acerto top-1 exige candidato correspondente em primeiro lugar e distância dentro da tolerância. Para POIs, correspondência usa nome/alias normalizado; para endereços, usa todos os tokens esperados. Acerto top-5 aplica a mesma regra aos cinco primeiros. Resposta HTTP válida sem candidatos conta como ausência; erros HTTP e timeout ficam separados. Duplicata é repetição de `place_id` ou de nome e posição normalizados entre os cinco primeiros.

O dado chinês usa as coordenadas de referência fornecidas pela amostra, sem transformação de datum. A diferença entre WGS-84 e GCJ-02 pode contribuir para as distâncias e requer avaliação específica antes de usar esse limiar como garantia de localização na China.

## Implementação e execuções

O CLI usa:

- `GET /v1/geocode/search` para POIs com `name`, cidade, país, `type=amenity`, `filter=countrycode`, idioma e limite 5;
- o mesmo endpoint para endereços com `text` livre, filtro de país, idioma e limite 5;
- `GET /v2/places` para POIs com categoria, `name`, `bias=proximity`, idioma e limite 5.

A documentação atual aceita `type` com `country`, `state`, `city`, `postcode`, `street`, `amenity` ou `locality`; `building` pode aparecer como `result_type`, mas não é um valor válido de parâmetro `type`. O primeiro benchmark enviou `type=building` nos 10 endereços e recebeu HTTP 400. O cliente deixou de enviar `type` para texto livre; os endereços foram reexecutados. Nove responderam normalmente; Queen’s Road Central expirou no cliente a 10 s e foi repetido com timeout de 30 s, com resposta HTTP 200 após 22,951 ms. Erro nunca foi contado como ausência.

Foram feitas 122 chamadas: 110 na inicial, 1 teste de fumaça após a correção, 10 na reexecução dos endereços e 1 repetição do timeout. A avaliação consolidada usa 100 respostas de POI da execução inicial e os 10 resultados finais de endereço. O JSON final registra essa regra e liga os relatórios brutos.

Geoapify documenta 1 crédito por solicitação de Geocoding e 1 crédito para Places com até 20 resultados. Como o limite usado foi 5, a amostra avaliada estima 110 créditos; somado o teste de fumaça HTTP 200, há 111 créditos estimados em respostas válidas. As 10 respostas HTTP 400 e a primeira tentativa expirada não entram na estimativa. Não foi consultado o painel de faturamento; cobrança dessas tentativas é desconhecida e pode elevar o uso real.

O relatório não inclui chave nem URL de chamada da API. O CLI lê `GEOAPIFY_API_KEY` do ambiente ou do `.env` local, que fica ignorado pelo Git.

## Conclusão para ADR 0001

**Recomendação: revisar a condição do ADR com o decisor; não alterei o ADR nesta subtarefa.** A medição combinada por chamadas ficou abaixo de 50% na China (top-1 46,7%; top-5 48,3%) e atingiu 50% no total; Places isoladamente teve resultado baixo (26,7% China e 30% global no top-1). Geocoding isoladamente passou a maioria nas duas regiões no top-1 (66,7% e 75%), com 68,3% e 75% no top-5. Em ao menos um método por caso houve candidato top-1 em 70% dos POIs chineses e 75% dos globais. Como o ADR não define como mesclar/rankear esses dois resultados, os dados não validam ainda um comportamento final de busca, embora a condição chinesa de revisão mereça decisão explícita.

As coordenadas de referência não foram verificadas, a amostra pequena tem viés de seleção, as fontes OSM podem se sobrepor ao fornecedor e os resultados foram coletados em execuções separadas. Portanto, esta é evidência exploratória, não validação de produção ou de licença/armazenamento.

## Pendente da etapa 3

Integrar o parser `@trippy/google-maps-links` e executar os 20 casos com ele; medir resolução correta e fallback. A subtarefa atual deixou a etapa sem alteração de arquivos do parser, lockfile ou configuração raiz. Também continuam pendentes a validação de termos/licença de armazenamento, comparação com Google e testes de atribuição indicados no ADR.

## Referências oficiais

- [Geoapify Forward Geocoding — parâmetros, tipos aceitos e créditos](https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/)
- [Geoapify Places — parâmetros, origem dos dados e créditos](https://apidocs.geoapify.com/docs/places/index.html)
