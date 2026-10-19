# Trippy: Fluxos e Telas

> Rascunho v0.2 de 19/out/2026, derivado de `visao-produto.md` (v0.3). Descreve o produto do ponto de vista de quem usa: o que cada pessoa vê e faz. Não define tecnologia nem layout final.
>
> Legenda: **[P]** marca uma proposta que ainda não foi aprovada pelo Guilherme. O que não tem marca segue uma decisão já registrada em `visao-produto.md`.

## A viagem tem 3 fases [P]

O app muda conforme a fase da viagem: a mesma viagem mostra coisas diferentes antes, durante e depois.

| Fase | Quando | Foco |
|---|---|---|
| **Planejando** | Da criação até a data de início | Sugerir lugares e montar o roteiro |
| **Em viagem** | Entre a data de início e a de fim | Tela Hoje, registrar visitas e mandar fotos |
| **Encerrada** | Depois da data de fim, ou quando o organizador toca em **Encerrar viagem** | Recap, álbum e memórias |

- **Mudança de datas:** se as datas mudarem antes do encerramento, a fase é recalculada.
- **Depois do recap:** se as datas mudarem depois que o recap já foi gerado, nada é apagado e nenhum vídeo novo é publicado automaticamente.

## Mapa de telas

```
Primeiro uso / Login
Minhas viagens (home)
├── Nova viagem
├── Viagem
│   ├── Hoje            (só Em viagem)
│   ├── Roteiro         (dias → lugares em ordem)
│   ├── Lugares         (todos os lugares: sugeridos, com dia, sem dia; reações "quero ir")
│   ├── Memórias        (álbum por lugar e por dia)
│   ├── Recap           (só Encerrada)
│   └── Grupo           (membros, papéis, convite, sair)
├── Lugar               (info, fotos, observações, avaliação, quem foi, favorito)
│   └── Cartão para mostrar (nome e endereço no idioma local, tela cheia)
├── Adicionar lugar     (nome, endereço ou link do Google Maps)
├── Convite             (página web aberta pelo link, sem instalar)
└── Conta e assinatura
```

A tela **Lugares** reúne todos os lugares da viagem com o status de cada um: *sugerido*, *no dia X* ou *sem dia*. Assim nenhum lugar aparece duplicado. A tela **Roteiro** mostra a mesma informação organizada por dia.

## Fluxos

### 1. Primeiro uso

- **Quem vem por convite:** cria a conta e cai direto na viagem do convite. O convite não se perde durante o cadastro.
- **Quem chega sem convite:** a home vazia oferece **Criar minha primeira viagem**.

### 2. Criar a viagem (organizador)

1. Toca em **Nova viagem** e preenche o nome (ex.: "Viagem China"), o destino, as datas e uma capa (opcional).
2. A viagem vazia mostra duas ações em destaque: **Adicionar lugares** e **Convidar pessoas**.
3. Gera um link de convite e manda pelo WhatsApp ou outro app.

### 3. Entrar na viagem (convidado)

1. Abre o link. Sem instalar o app, já consegue consultar a viagem. [P] O que exatamente aparece antes de entrar no grupo depende de uma decisão em aberto: o que acontece quando o link é repassado.
2. Toca em **Participar**, instala o app e cria a conta.
3. Na entrada, um aviso deixa claro que fazer parte do grupo autoriza compartilhar o vídeo recap, inclusive fora do app.

### 4. Sugerir um lugar (qualquer membro)

1. Toca em **+ Lugar** e busca pelo nome ou endereço, ou cola um link do Google Maps.
2. Confirma o lugar encontrado e, se quiser, deixa um comentário ("vi num vídeo, a vista é incrível").
3. O lugar entra em **Lugares** como *sugerido*, com o nome de quem sugeriu.
4. Os outros membros podem reagir com **quero ir**, com um toque.

### 5. Montar o roteiro (organizador e coorganizadores)

1. Em **Lugares**, escolhe um lugar e define o dia. [P] A lista pode ser ordenada pelo número de reações "quero ir".
2. Ordena os lugares dentro de cada dia.
3. Os outros membros só consultam o roteiro.

### 6. Preparar para viajar [P]

Nos dias antes do início, o organizador vê um aviso **Pronto para viajar** que mostra:

- quais lugares ainda estão sem endereço no idioma local;
- no caso de destinos com restrição, como a China, a recomendação de cadastrar os lugares antes de embarcar;
- quantos membros já entraram no app e abriram a viagem pelo menos uma vez, porque é isso que deixa o roteiro guardado no celular de cada um.

### 7. Durante a viagem: tela Hoje (todos)

Quando a viagem começa, ela abre direto na tela **Hoje**:

1. **Dia atual:** por exemplo, "Dia 3 de 12: Xangai".
2. **Próximo lugar:** com o botão **Mostrar endereço**, que abre o cartão em tela cheia com o nome e o endereço no idioma local.
3. **O que mudou:** as alterações do roteiro que o celular já recebeu.
4. **Lugares do dia:** em ordem, cada um com os atalhos **Eu fui**, **Favorito** e **Foto**.
5. **[P] Estamos aqui:** registra um lugar fora do roteiro. Ainda falta decidir como adicionar lugares na China.

**Sem internet:**

- O roteiro guardado, os registros e as fotos continuam funcionando.
- A tela mostra a hora da última atualização ("roteiro atualizado às 9h") e quais registros ainda não foram enviados.
- O app nunca dá a entender que a pessoa está vendo a versão mais recente quando ela pode estar desatualizada.

### 8. Tela do lugar (todos)

- Fotos, observações e avaliação. Todos os campos são opcionais.
- **Quem foi:** cada pessoa marca a própria presença. O organizador e os coorganizadores também podem marcar outras pessoas, e quem foi marcado por engano pode desmarcar a si mesmo.
- **Favorito:** é separado de "eu fui", porque ir não significa gostar.

### 9. Fotos (todos)

1. A pessoa manda várias fotos de uma vez, quando for conveniente. [P] O app pode lembrar à noite.
2. Ela escolhe o lugar de cada foto, ou deixa a foto sem lugar. [P] O app pode sugerir o lugar pela hora em que a foto foi tirada.
3. Qualquer membro pode salvar no próprio celular fotos tiradas por outras pessoas.
4. Quem pode esconder ou remover uma foto: o autor, o organizador e os coorganizadores. O app avisa que cópias já salvas por outras pessoas não somem.

### 10. Grupo (organizador e coorganizadores)

- **Papéis:** o organizador promove membros a coorganizador ou volta atrás.
- **Remover membro:** o organizador e os coorganizadores podem remover membros.
- **Sair do grupo:** qualquer membro pode sair. O que ele registrou continua no grupo.
- **Organizador sai:** um coorganizador assume. Se não houver coorganizador, assume um membro aleatório, e o grupo é avisado de quem é o novo organizador.

### 11. Fim da viagem: recap (todos)

1. Quando a viagem termina, o app gera o recap automaticamente com o conteúdo que já existe e avisa o grupo.
2. O recap é uma sequência de telas no estilo Spotify Wrapped. **Uma tela só aparece quando há dados suficientes para ela.**
   - **Sempre:** a viagem em números (dias, lugares visitados, fotos) e os destaques do álbum.
   - **Quando há dados:** o favorito do grupo, os lugares mais bem avaliados (nunca com uma avaliação só), e o momento de cada pessoa (um destaque pessoal dentro do recap do grupo, não um vídeo separado).
   - **[P] Para depois:** mapa do percurso e "dia mais intenso".
3. No fim da sequência vem o **vídeo curto**, com **Compartilhar** e **Baixar**. Quanto menos fotos, mais curto o vídeo. Ele leva uma marca discreta do Trippy, que não aparece para assinantes.
4. **Estados do recap:**
   - *Gerando*.
   - *Falhou*, com o botão **Tentar de novo**.
   - *Sem fotos*: o álbum mostra só os registros, e o vídeo vira uma versão honesta, só com os lugares.
5. Se chegarem fotos novas depois, o organizador pode **gerar de novo**. O grupo vê o recap atualizado, e quem quiser publica de novo.

### 12. Depois da viagem (todos)

- A viagem fica em **Memórias** na home, com a capa do recap.
- A home convida a pessoa a planejar a próxima viagem. É assim que um convidado vira organizador.

### 13. Conta e assinatura

- Mostra se a pessoa é assinante e até quando.
- Permite gerenciar ou cancelar a assinatura.
- Antes de a assinatura acabar, avisa por quanto tempo as memórias continuam disponíveis e oferece baixar o álbum e o vídeo.
- Os valores e a divisão entre o que é gratuito e o que é pago estão em aberto na `visao-produto.md`.

## Telas sem conteúdo

Toda tela vazia mostra o próximo passo sem cobrar participação de ninguém. Por exemplo:

- **Lugares sem sugestões:** "Adicione o primeiro lugar ou convide o grupo".
- **Dia sem lugares:** "Dia livre. Quer adicionar algum lugar?"
- **Lugar sem endereço no idioma local:** um aviso para o organizador.
- **Memórias sem fotos:** "As fotos da viagem aparecem aqui".

## Perguntas em aberto destes fluxos

- **Fases e datas [P]:** as fases automáticas e o botão **Encerrar viagem** fazem sentido?
- **Recap sem espera [P]:** está bom gerar o recap assim que a viagem acaba, e permitir gerar de novo depois? A alternativa seria esperar alguns dias para o grupo mandar fotos.
- **Lembrete e sugestão de lugar [P]:** o lembrete noturno e a sugestão automática de lugar para as fotos entram no MVP ou ficam para depois?
