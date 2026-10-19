# Pesquisa: fornecedor de lugares

> 19/out/2026. **A decisão final está no `docs/adr/0001-fornecedores-de-lugares.md`**, que substitui a recomendação abaixo (a Foursquare API foi descartada, e o Google entrou como enriquecimento ao vivo). Pesquisa documental feita em paralelo pelo Claude Code e pelo Codex, nos termos oficiais de cada fornecedor. **Ainda sem benchmark.** A cobertura real (principalmente na China) é medida no spike A.

## O que o Trippy precisa

1. **Licença que permita guardar para sempre** nome, endereço e coordenadas do lugar escolhido, e mostrar isso ao grupo. É o que sustenta o cartão offline, as memórias e o recap.
2. Nome e endereço **no idioma local**, inclusive em chinês.
3. Boa cobertura no mundo e, de preferência, na China.
4. Busca por nome e por endereço, e lugares próximos de uma coordenada (para o "Estamos aqui").
5. Aceitar um link do Google Maps colado pelo usuário.
6. Custo baixo no início e pouco acoplamento.

## O problema central

**Quase todo fornecedor comercial proíbe guardar os dados.** Quem permite guardar são os serviços baseados em **dados abertos**. Em compensação, esses dados abertos são justamente os mais fracos na China.

## Comparação

| Fornecedor | Pode guardar para sempre? | Custo inicial | China e idioma local |
|---|---|---|---|
| **Google Places** | ❌ Só o `place_id`. Lat/lng por até 30 dias, e o resto não pode ser guardado. ([políticas](https://developers.google.com/maps/documentation/places/web-service/policies), [termos](https://cloud.google.com/maps-platform/terms/maps-service-terms)) | 10 mil chamadas/mês grátis, depois ~US$ 5/1.000 | Boa busca, mas os dados da China são fracos |
| **Mapbox Search Box** (lugares) | ❌ Uso temporário; guardar exige contrato comercial ([doc](https://docs.mapbox.com/api/search/search-box/)) | 2.500 sessões/mês grátis | Chinês não aparece entre os idiomas e regiões suportados |
| **Mapbox Geocoding permanente** | ✅ Para **endereços**, mas não tem pontos de interesse, e a redistribuição precisa ser esclarecida ([doc](https://docs.mapbox.com/api/search/geocoding/)) | ~US$ 5/1.000, sem franquia | Tem chinês, mas não busca atrações nem restaurantes |
| **HERE** | ❌ Resultados de busca por no máximo 30 dias ([termos](https://legal.here.com/us-en/terms/here-platform-terms)) | Não confirmado | Não verificado |
| **TomTom** | ⚠️ Cláusula vigente não encontrada | 5 a 20 mil chamadas/mês grátis | Na China, cobertura só no nível de cidade ([cobertura](https://docs.tomtom.com/search-api/documentation/product-information/market-coverage)) |
| **Foursquare Places API** | ❌/⚠️ Só os IDs (não confirmado na página oficial) ([EULA](https://foursquare.com/legal/terms/apilicenseagreement/)) | 500 chamadas/mês grátis, depois US$ 15/1.000 | Nomes nem sempre traduzidos |
| **Radar** | ❌ No máximo 30 dias, e é proibido montar uma base ([termos](https://radar.com/terms)) | — | — |
| **Apple Maps Server API** | ❌ Proíbe base secundária e só permite cache temporário ([licença do Apple Developer Program](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/)) | Exige conta Apple Developer | Na China usa dados da Amap (bom), mas não pode ser guardado |
| **Amap / Gaode** | ❌ Sem contrato comercial ([termos](https://lbs.amap.com/pages/terms/)) | Cadastro exige celular chinês; licença comercial a partir de ¥ 50 mil/ano | **O melhor na China**, mas inviável agora |
| **Geoapify** (dados do OpenStreetMap) | ✅ "Pode guardar, armazenar e redistribuir", com atribuição ao OSM (e à Geoapify no plano grátis) ([Places](https://www.geoapify.com/places-api/), [termos](https://www.geoapify.com/terms-and-conditions/)) | **3 mil créditos/dia grátis**, depois US$ 59/mês | Tem nome, `lang` e busca por proximidade. Na China, depende do OSM (testar) |
| **FSQ OS Places** (dataset aberto, não é API) | ✅ Apache 2.0 ([dataset](https://docs.foursquare.com/data-products/docs/fsq-places-open-source)) | Dados grátis; índice e busca são nossos | Mais de 100 milhões de lugares no mundo; China não verificada |
| **Overture Maps Places** (dataset aberto) | ✅ CDLA-Permissive 2.0 ([guia](https://docs.overturemaps.org/guides/places/)) | Dados grátis; índice e busca são nossos | Tem nomes alternativos e traduções; China não verificada |
| **OpenStreetMap** (Nominatim/Photon) | ✅ ODbL, com atribuição e compartilhamento da base derivada ([ODbL](https://opendatacommons.org/licenses/odbl/1-0/)) | O servidor público tem limite de 1 req/s e não serve para produção | Pequim e Xangai razoáveis nos lugares principais; o resto da China é fraco |

## Recomendação

1. **Para o beta: Geoapify**, atrás do adaptador `PlacesProvider`.
   - É uma API pronta, grátis no início, e a licença permite guardar e redistribuir.
   - **Antes de fechar,** vale pedir à Geoapify uma confirmação por escrito de que guardar nome, endereço e coordenadas de lugares, mostrar ao grupo e usar no recap está coberto.
   - **Atribuição:** mostrar "© OpenStreetMap" (e "Powered by Geoapify" no plano grátis) onde os dados aparecem.
2. **Depois do beta: índice próprio com Overture ou FSQ OS Places.** Isso tira a dependência de uma API paga e reduz o acoplamento a quase zero, mas dá trabalho de infraestrutura (importar, indexar, atualizar). Começar só pelas regiões dos destinos.
3. **China:** nenhuma opção que permita guardar é forte lá. Como a China não é o caso principal:
   - a busca usa o mesmo fornecedor;
   - o **endereço em idioma local continua editável** no cartão, para o organizador completar;
   - o "Pronto para viajar" avisa quais lugares estão sem endereço local.
4. **Link do Google Maps:**
   - O servidor expande o link curto seguindo só os redirecionamentos HTTP, com allowlist de domínios do Google e proteção contra SSRF.
   - Depois, extrai o nome e as coordenadas que aparecem **no próprio texto da URL**, sem chamar a API do Google e sem raspar a página.
   - Com isso, busca os candidatos no Geoapify, e a pessoa escolhe o certo.
   - O link original fica guardado como referência do usuário. Quando não houver o suficiente na URL, o app pede para a pessoa digitar o nome.

## Cuidados técnicos

- **Coordenadas na China:** os mapas chineses (inclusive o Apple Maps dentro da China) usam o sistema **GCJ-02**, deslocado algumas centenas de metros em relação ao GPS (WGS-84), que é o que o OSM usa. Por isso, o "Abrir no mapa" usa **nome + endereço** como busca, e não só as coordenadas. Guardamos sempre o sistema de coordenadas de origem.
- **Proveniência:** cada lugar guarda `provider`, `provider_ref`, a licença e o que foi corrigido pelo usuário, separado do dado original.

## Spike A: como validar

- **Amostra:**
  - 30 lugares na China (atrações, restaurantes e hotéis em Pequim e Xangai, incluindo alguns menos conhecidos);
  - 20 lugares no resto do mundo;
  - 10 endereços sem ponto de interesse;
  - 20 links do Google Maps em formatos diferentes.
- **Fornecedores medidos:** Geoapify, e Overture e FSQ OS Places por amostra local.
- **O que medir:** se acha o lugar certo, nome original, endereço local completo, precisão da posição e busca em português, inglês e chinês.
- **Critério:** o Geoapify passa se acertar a maioria dos lugares globais e os principais da China. Se não passar, comparamos com o índice próprio antes de decidir.
