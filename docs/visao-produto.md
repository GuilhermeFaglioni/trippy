# Trippy — Visão de Produto

> Rascunho v0.2 — 19/out/2026. Construído a partir das respostas do Guilherme às rodadas de perguntas de escopo (Claude Code + Codex). Só produto: nada de tecnologia ainda.

## Em uma frase

App mobile (iOS e Android) onde um grupo planeja a viagem junto e guarda as memórias de cada lugar visitado. No fim, recebe um recap pronto: álbum com destaques e vídeo curto, no estilo Spotify Wrapped.

## Problema

Hoje viagens em grupo são organizadas no improviso:

- **Decisões perdidas no WhatsApp:** sugestões de lugares se perdem na conversa e ninguém sabe qual é o plano atual.
- **Fotos espalhadas:** cada pessoa tem as suas no próprio celular, e elas raramente se juntam.
- **Memórias desorganizadas:** depois da viagem não sobra um registro de onde foram, o que acharam e o que viveram.

O concorrente real é o improviso: WhatsApp, listas do Google Maps e álbum compartilhado. Apps especializados como Wanderlog, Polarsteps e TripIt são referências, não o ponto de partida.

## Para quem

- **Segmento inicial:** quem organiza viagens internacionais em grupo, entre amigos ou família. É quem cria a viagem no app. Que esse seja o segmento que mais sente a dor ainda é uma hipótese, sem pesquisa por trás.
- **Convidados:** os outros membros do grupo, que participam com pouco ou muito esforço (veja "Participação").
- **Mercado inicial:** brasileiros, app em português, viajando para qualquer destino.

## Proposta de valor

Roteiro e memórias no mesmo lugar, e no fim da viagem um recap pronto, sem precisar montar nada.

## Ciclo do MVP

1. **Criar a viagem:** o organizador cria o grupo (ex.: "Viagem China") e convida as pessoas.
2. **Sugerir lugares:** qualquer membro pode adicionar, individualmente, os lugares que quer visitar. A viagem funciona mesmo que só o organizador contribua.
3. **Montar o roteiro:** o usuário controla manualmente o lugar, o dia e a ordem. Uma pessoa sozinha também consegue planejar.
4. **Viajar:** o grupo consulta o roteiro e registra as visitas, com fotos, observações e avaliação por lugar.
5. **Recap:** no fim, o app gera um álbum com destaques e um vídeo curto, no estilo Spotify Wrapped e YouTube Music Recap.

### Precisa funcionar sem internet

- Ver o roteiro.
- Registrar visitas.
- Adicionar fotos.

### Fora do MVP (explicitamente)

- O app sugerir ou gerar o roteiro.
- Editor de vídeo detalhado.
- Controle e divisão de gastos.
- Perfil público e descoberta de roteiros de outras pessoas.

## Participação

Se só o organizador se dedicar, os convidados ainda recebem o roteiro e as lembranças de cada lugar. Toda participação dos convidados é opcional: eles recebem valor mesmo sem contribuir.

### Valor para o convidado com pouco esforço

**Antes da viagem**

1. **Ver o roteiro por link, sem instalar o app:** o convidado já vê o plano ao receber o convite. O link não é público; ainda falta decidir o que acontece quando ele é repassado para alguém de fora do grupo.
2. **Reagir às sugestões com um toque ("quero ir"):** é mais leve que uma votação e mostra ao organizador as preferências do grupo. A reação não decide nada, e não reagir não é rejeição.

**Durante a viagem**

3. **Cartão do próximo lugar com endereço no idioma local:** dá para mostrar ao taxista ou atendente e chegar sem depender do organizador.
4. **Resumo do dia com as mudanças em destaque:** o que tem hoje, o próximo lugar e o que mudou, sem precisar procurar no WhatsApp.
5. **"Eu fui" e "meu favorito" com um toque por lugar:** monta o histórico de cada um e alimenta os destaques do recap, sem obrigar ninguém a escrever avaliação. Ter ido não significa ter gostado.

**Depois da viagem (ou no fim de cada dia)**

6. **Subir fotos em lote:** a pessoa manda as melhores de uma vez, sem interromper o passeio.
7. **Pegar fotos dos outros para si:** o convidado encontra fotos de momentos em que não tirou nenhuma, o que incentiva a mandar as suas também.
8. **Destaque pessoal no recap:** cada pessoa vê os seus momentos dentro do recap do grupo. Um vídeo diferente por pessoa fica para depois de provarmos que o recap do grupo funciona.

## Privacidade

- Todo grupo é fechado por padrão.
- Entrar no grupo já vale como aprovação para compartilhar o vídeo recap.

## Sucesso

- **Beta (jan/2027):** a família do Guilherme completa o ciclo inteiro numa viagem à China. É um caso extremo: serviços do Google bloqueados e internet instável. Em seguida, alguns grupos de fora usam o app sem a ajuda do Guilherme.
- **Valor duradouro:** o cliente volta para planejar a próxima viagem, o grupo revisita e compartilha as memórias entre uma viagem e outra, e organizadores criam novas viagens com outros grupos e recomendam o app.

## Perguntas em aberto

- **Precificação:** quem paga, pelo quê e com qual unidade de cobrança. (O Guilherme ainda vai pensar.)
- **Aquisição e marketing:** como chegam os primeiros organizadores. (O Guilherme ainda vai pensar.)
- **Detalhes da experiência:** quem edita e confirma o roteiro, como se adiciona um lugar (inclusive na China), se as visitas são individuais ou do grupo, e quanto o grupo escolhe antes de gerar o recap.
- **Alcance da aprovação do vídeo:** se entrar no grupo também autoriza qualquer membro a postar o vídeo fora do app (redes sociais, por exemplo), e como fica quem aparece nas fotos sem ser membro.
- **Mudanças de plano:** como os convidados ficam sabendo quando o roteiro muda durante a viagem, inclusive sem internet.
- **Recap com pouco conteúdo:** o que o álbum e o vídeo mostram quando há visitas sem foto ou quando só uma pessoa contribuiu.
- **Entrada e saída do grupo:** o que acontece com as fotos e registros de quem sai do grupo, e com pessoas que aparecem nas fotos mas não são membros.
- **Critérios do beta:** o que conta como "completou o ciclo" e quantos grupos de fora precisam usar o app, e por quanto tempo.
- **Demanda e pagamento:** o beta com a família mostra se o app funciona, mas não mostra se o segmento quer o app nem se pagaria por ele.
