# ADR 0001: Fornecedores de lugares

- **Status:** aceito em 19/out/2026, condicionado ao spike A. **Revisado em 20/out/2026** após o spike #18 (veja "Revisão após o spike #18"): fornecedor mantido provisoriamente; a validação final fica com a #25.
- **Decisores:** Guilherme, com debate entre Claude Code e Codex.
- **Pesquisa:** `docs/pesquisa-fornecedores-lugares.md`.

## Contexto

O Trippy precisa que a pessoa **busque, descubra, enriqueça, confirme e salve** lugares. O que é salvo sustenta o cartão offline, as memórias e o recap. Por isso, **precisa poder ser guardado para sempre**.

O Google tem os dados mais ricos, mas os termos dele só permitem guardar o `place_id`. Fornecedores com licença que permite guardar (OpenStreetMap, datasets abertos) são mais pobres, principalmente em restaurantes e na China. A Foursquare Places API também não permite guardar e só tem 500 chamadas grátis por mês.

## Decisão

Cada função tem um fornecedor:

| Função | Fornecedor | Observações |
|---|---|---|
| **Buscar por nome** | **Geoapify** (Geocoding com `type=amenity` e Places com `name=`) | Usa o destino da viagem como referência (`bias`/`filter`). Plano grátis: 3 mil créditos/dia e 5 req/s, com uso comercial permitido. |
| **Descobrir** (categoria + raio) | **Geoapify Places** | Mesma franquia. |
| **Salvar** | **Geoapify**, mais o `place_id` do Google quando houver | É a única fonte persistida. Também guarda a origem dos dados e a licença de cada campo. |
| **Enriquecer e confirmar** ("Detalhes do Google") | **Google Places, ao vivo** | Só quando a pessoa toca no botão. Veja as regras abaixo. |
| **Cobrir lacunas e escalar** | **FSQ OS Places** (Apache 2.0), como índice próprio | Fica para depois do beta, se o spike ou o volume justificarem. |
| ~~Foursquare Places API~~ | — | Descartada: mais cara que a franquia grátis do Google para o mesmo papel. |

### Regras do enriquecimento com o Google

1. **Os nossos dados vão ao Google, mas os dados do Google nunca voltam para o nosso banco.** O backend chama o **Text Search** com nome e coordenadas **vindos da Geoapify**. A chamada usa `locationRestriction`, que é um retângulo em volta do ponto: o `locationBias` só favorece a região, não limita.
2. **IDs Only não basta para confirmar.** O candidato é exibido com **Place Details Pro** (nome, tipo e endereço) e **uma foto**. Os campos são pedidos por *field mask*, nunca com `*`.
3. **Quem confirma é a pessoa:** "É este lugar?". Não há vínculo automático e nenhuma comparação calculada sobre as coordenadas do Google. O §3.2.3(c)(iv) cita explicitamente o uso das coordenadas da Places API como entrada de outra análise. Se a pessoa disser que não, fica "sem correspondência", e ela pode tentar outro candidato.
4. **Só o `place_id` é guardado** (exceção dos termos). Nome, endereço, fotos, nota, horário e as URLs de foto **nunca** vão para o SQLite, o S3, as miniaturas, o snapshot do recap ou os logs persistentes. As URLs e os nomes de foto expiram. Offline, o bloco do Google aparece como **indisponível**, e o app não reaproveita a última foto.
5. **Apresentação:**
   - o conteúdo do Google fica num **bloco visualmente separado** da nossa ficha, com a marca do Google Maps, as `authorAttributions` das fotos e um link para o `googleMapsUri`;
   - o botão se chama **"Detalhes do Google"**, para não sugerir que o Google valida a nossa ficha;
   - nunca sobre um mapa de outro fornecedor (o app não tem mapa embutido).
6. **Nota e horário** (Place Details Enterprise) são opcionais. Quando usados, **substituem** o Pro na cobrança (não somam).
7. **Proteções de custo:**
   - limites por usuário e por viagem;
   - deduplicação de chamadas simultâneas para o mesmo lugar;
   - *timeout* e *backoff*;
   - alerta de consumo no faturamento do Google, lembrando que o alerta não é um teto de cobrança.
8. **O enriquecimento é um extra.** Salvar, viajar offline e o recap nunca dependem do Google. Se o Google falhar ou estiver bloqueado (na China), o app funciona igual.

### Link do Google Maps colado pela pessoa

- O backend expande o link curto seguindo **só os redirecionamentos HTTP**, com allowlist de domínios do Google, limite de saltos e proteção contra SSRF.
- Ele extrai do **texto da URL** o nome e/ou as coordenadas, sem abrir a página e sem scraping, e busca os candidatos na **Geoapify**. A pessoa escolhe.
- O link original fica guardado como "referência informada pelo usuário".
- ID opaco, viewport (`@lat,lng` da câmera) e link de lista não identificam um lugar com segurança. Nesses casos, o app pede para a pessoa buscar pelo nome.

### Atribuições

- **Dados salvos:** "© OpenStreetMap contributors" e "Powered by Geoapify" (exigido no plano grátis), inclusive offline.
- **Bloco do Google:** a marca do Google Maps e a atribuição de cada foto.
- **O Trippy implementa** os requisitos de termos e de privacidade do §3.2.2 dos termos do Google.

## Consequências

- **Custo estimado (100 viagens/mês, ~5 mil toques no enriquecimento):**
  - Geoapify: US$ 0;
  - Google Text Search IDs Only: US$ 0;
  - Place Details Pro: US$ 0 (dentro da franquia de 5 mil);
  - fotos: ~US$ 28.
  - Somando a infraestrutura, o total fica em **~US$ 40–70/mês**.
  - O custo cresce com **toques, candidatos, fotos e novas tentativas**, não com o número de viagens. Com 50 mil enriquecimentos por mês, seriam ~US$ 1.108 só de Google.
  - Restringir o enriquecimento a assinantes é uma decisão de produto para depois. Não vale no beta, que não tem assinaturas.
- **Qualidade da busca:** fica limitada ao OpenStreetMap. Restaurantes pequenos e lugares novos podem faltar. O plano B é o cadastro manual (nome digitado + GPS) e, mais adiante, o índice do FSQ OS Places.
- **China:** a busca usa a Geoapify, e o Google não funciona lá. O endereço local continua editável no cartão. Coordenadas WGS-84 × GCJ-02: o "Abrir no mapa" busca por nome + endereço.
- **Acoplamento:** todos os fornecedores ficam atrás do adaptador `PlacesProvider`. As referências de cada fornecedor (`geoapify`, `google_place_id`, futuramente `fsq_place_id`) ficam separadas do registro durável.
- **Licenças a confirmar antes do lançamento:** o escopo exato do armazenamento e da redistribuição de **Places** na Geoapify, e as obrigações da ODbL sobre base derivada. Este ADR registra uma leitura técnica dos termos, **não um parecer jurídico**.

## Spike A: o que precisa ser medido

1. **Busca da Geoapify:**
   - **Amostra:**
     - atrações, restaurantes (incluindo filiais) e hotéis em Pequim e Xangai;
     - destinos globais;
     - nomes em português, inglês e chinês;
     - endereços sem ponto de interesse.
   - **Métricas:** acerto no primeiro resultado e entre os primeiros, endereço local completo, coordenada da entrada, ausências e duplicatas.
2. **Correspondência Geoapify → Google:**
   - **Métricas:** precisão dos pares aceitos pela pessoa, falsos positivos, casos sem correspondência e quantas vezes ela precisa escolher.
   - **Casos difíceis:** mesma marca por perto, nomes traduzidos, lugar fechado ou mudado, e sistemas de coordenadas diferentes.
3. **Custo e operação:**
   - créditos da Geoapify por percurso e no pico;
   - SKUs do Google efetivamente cobrados por *field mask*;
   - chamadas reais por toque, incluindo foto e novas tentativas;
   - latência e erros.
4. **Conformidade:**
   - provar, inspecionando o código e os dados, que **nada do Google** é persistido (SQLite, S3, snapshot, logs);
   - provar que as atribuições aparecem em todas as variantes da tela.
5. **Link colado:** 20 links do Google Maps em formatos diferentes. Medir a taxa de resolução correta e quando é preciso buscar pelo nome.

**Este ADR é revisto se** a Geoapify não acertar a maioria dos lugares globais e os principais da China, ou se a correspondência com o Google exigir escolha manual na maioria dos casos.

## Revisão após o spike #18 (20/out/2026)

Resultado completo em `docs/spikes/18-geoapify.md`. Debatido entre Claude Code e Codex e aprovado pelo Guilherme.

**O que o spike mostrou** (acerto no 1º resultado, por lugar):

| Método | China (30) | Resto do mundo (20) |
|---|---|---|
| Geocoding da Geoapify (`type=amenity` + nome) | 20 (67%) | 15 (75%) |
| Places da Geoapify (categoria + nome) | 8 (27%) | 6 (30%) |
| Melhor dos dois | 21 (70%) | 15 (75%) |

O endereço local completo quase nunca veio na China (1 de 60 chamadas, medido por tokens). O parser acertou os 24 links rotulados.

**Isto não é uma aprovação da condição do ADR.** As referências não foram verificadas, as fontes OSM podem coincidir com o fornecedor, a tolerância na China foi de 1 km e o método foi escolhido depois de comparar os resultados. O fornecedor fica **mantido provisoriamente**, e a validação acontece na #25, com o fluxo final congelado.

**Ajustes na decisão:**

1. **Buscar por nome:** o Geocoding é a fonte principal. Sem mesclagem automática com o Places. O Places aparece como **segunda tentativa** quando o Geocoding vier vazio ou quando a pessoa rejeitar os candidatos. A #25 decide se isso vira automático, medindo o ganho real (a união acrescentou só 1 lugar na China e nenhum fora dela).
2. **Descobrir** (categoria + raio) continua no Places, mas este spike não mediu esse percurso. Ele precisa de medição própria.
3. **Endereço e nome locais:**
   - o campo de endereço local é **sempre editável**;
   - o app **destaca** quando o endereço está ausente, parece incompleto ou não está no idioma local. O alfabeto do destino é só um sinal auxiliar, nunca a única regra;
   - a pessoa pode salvar com a pendência. O "Pronto para viajar" e o cartão offline avisam o que falta;
   - o nome local também tem o estado "ausente / não confirmado". O app não supõe que o fornecedor o entregue;
   - o que a pessoa digita é fonte própria e fica separado do dado do fornecedor. **Copiar endereço do Google para a ficha continua proibido.**
4. **Proveniência:** guardar o `datasource` e as atribuições que o Geocoding devolve, porque ele mistura fontes. Não presumir que tudo é OSM.
5. **O que a #25 mede**, com o fluxo final:
   - amostra independente, com referências verificadas, filiais e entradas, e o datum documentado (WGS-84 × GCJ-02);
   - consultas em português, inglês e no idioma local;
   - top-1 e top-5 **por lugar e por segmento**. Na China, um recorte explícito das atrações essenciais;
   - separar "o candidato certo apareceu" de "a pessoa escolheu o certo";
   - endereço local medido sobre o candidato escolhido;
   - correspondência com o Google;
   - créditos pelo painel de faturamento, não estimados.

**Continuam pendentes:** a confirmação dos termos de armazenamento e redistribuição do Places e as obrigações da ODbL.
