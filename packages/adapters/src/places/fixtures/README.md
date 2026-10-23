# Fixtures contratuais Geoapify

Esses arquivos são exemplos sintéticos construídos a partir dos formatos publicados na documentação. **Não são respostas capturadas da API**, não representam lugares reais e não contêm dados de conta ou credenciais.

- `geoapify-geocoding-json.json`: estrutura plana de `results[]` do [Forward Geocoding](https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/), usando `format=json`.
- `geoapify-places-geojson.json`: estrutura `FeatureCollection` com `features[].properties` documentada para [Places](https://apidocs.geoapify.com/docs/places/index.html).

Os nomes e identificadores com `Teste`/`contract` existem somente para os testes locais. As fixtures protegem o adaptador contra regressões no formato dos dois produtos, sem fazer chamadas externas.
