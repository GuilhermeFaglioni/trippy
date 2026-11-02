# #47 — Revisão da `amostra-25.json` (2/nov/2026)

Padrões aprovados pelo Guilherme em 25/out/2026. Feito só com pesquisa na web e arquivos locais: **nenhuma chamada à Geoapify ou ao Google**, e a T5 real continua dependendo do orçamento da #48.

## Tolerâncias (B4)
| Caso | Antes | Agora | Motivo |
|---|---|---|---|
| `cn-sh-bund` | 150 m (medido 518 m) | **600 m** | Calçadão ribeirinho de ~1,5 km, sem entrada única; a referência é um ponto representativo. |
| `global-banff-springs` | 250 m (medido 315 m) | **350 m** | Resort extenso; a referência fica no centro do complexo. |

O motivo está no `toleranceReason` de cada caso.

## Outros ajustes
- **Savoy:** Wikidata `Q27081583` → `Q746639` (P625 = 51.509898, -0.120215, ~20 m do ponto da amostra).
- **Opposite House:** segue `unverified`, agora com motivo explícito (Q16947066 sem P625; página oficial só confirma o endereço textual).

## 10 endereços (C1)
A coordenada de um endereço só vale se vier de fonte independente do OSM. Os localizadores postais oficiais exigem consulta interativa e não dão coordenada, então o critério usado foi o edifício no endereço com coordenada na Wikipedia.

| Caso | Resultado |
|---|---|
| `addr-nyc-broadway-120` | **verified** — Equitable Building, 40.70833, -74.01028 (Wikipedia/Structurae) |
| `addr-toronto-king-100` | **verified** — First Canadian Place, 43.648778, -79.381694 (Wikipedia/Structurae) |
| `addr-sao-paulo-paulista-1578` | unverified — é o MASP (endereço confirmado no site oficial), mas nenhuma fonte consultada mostrou a coordenada |
| `addr-sydney-king-25` | unverified — edifício identificado (King × Sussex), sem coordenada oficial |
| `addr-paris-paix-15` | unverified — só diretórios comerciais; BAN/La Poste não consultados |
| `addr-tokyo-shiba-4` | unverified — 芝公園4-1-1 não associado a um edifício verificável |
| `addr-madrid-atocha-9` | unverified — edifício não identificado |
| `addr-rome-corso-3` | unverified — edifício não identificado |
| `addr-auckland-queen-100` | unverified — nenhuma fonte achou edifício em 100 Queen Street |
| `addr-hk-peking-12` | unverified — "12 Peking Road" provavelmente não existe (o "12" parece ser o andar do One Peking, 1 Peking Road) |

Cada lacuna está em `verification.reason` do caso.

## Efeito na T5
Amostra medida: 47 → **49** de 60 (11 excluídos). O segmento endereço passa a ter 2 casos (6 consultas primárias) em vez de 0, o que só permite uma leitura qualitativa do critério "endereço local".

## Pendências para quem for completar
- Resolver os 8 endereços restantes com BAN (França), GSI/Japan Post, Land Information NZ, Lands Department de Hong Kong, etc., ou **trocar os endereços** por prédios com coordenada oficial. Trocar `addr-hk-peking-12` por 1 Peking Road é o caminho mais curto.
