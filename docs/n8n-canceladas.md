# Base → LiveOps: Canceladas e Canceladas com NF

Fluxo pronto: **`docs/n8n-cancelados-workflow.json`** — 12 nós, importar no n8n
em *Workflows → Import from File*.

Ele lê os pedidos cancelados na Base (BaseLinker) e grava a solicitação no
LiveOps. A tarefa em Tarefas Diárias o próprio sistema gera — o n8n grava **um
registro** e para por aí.

---

## 1. Onde o registro cai

```
suplelive/reg/canceladas/<id>       ← sub-aba Pedidos → Canceladas
suplelive/reg/canceladasNF/<id>     ← sub-aba Pedidos → Canceladas com NF
```

O id é `canc_<número do pedido>` ou `cancnf_<número do pedido>`.

Todo navegador aberto escuta essas duas árvores. Assim que um registro aparece:

1. a linha aparece na tabela, sem ninguém atualizar a página;
2. o sistema percebe que a solicitação não tem tarefa e cria a tarefa diária,
   com Gustavo e CM Andrade como responsáveis e prazo de 24h;
3. os dois recebem a notificação.

**Por que o n8n não cria a tarefa também:** as regras (quem responde, o prazo, o
texto das considerações) ficam num lugar só, dentro do sistema. Mudou lá, o n8n
continua igual.

---

## 2. As duas credenciais

| Nó | Credencial |
|---|---|
| `Base · status (canceladas)`, `Base · página de cancelados` | **Header Auth** chamada `Base (BaseLinker)` — Name `X-BLToken`, Value = o token |
| os quatro nós do Firebase | **Google Service Account API** chamada `Firebase (conta de serviço)` |

Não existe credencial "Firebase" no n8n — o tipo é **Google API**. Escopos:

```
https://www.googleapis.com/auth/firebase.database
https://www.googleapis.com/auth/userinfo.email
```

Ligue **Set up for use in HTTP Request node**. Conta de serviço não passa pelas
regras de segurança do banco, então não é preciso mexer nas regras publicadas —
e é por isso que o `.json` da chave privada nunca entra no repositório.

---

## 3. O que cada nó faz

```
Rodar agora ┐
A cada hora ┘→ Base · status (canceladas)
                → Quais status são cancelamento
                  → Canceladas já gravadas        (GET ?shallow=true)
                    → Com NF já gravadas          (GET ?shallow=true)
                      → Ponto de partida (canceladas)
                        → Base · página de cancelados ←──────┐
                          → Separar cancelamentos            │
                             ├→ Gravar canceladas            │
                             ├→ Gravar canceladas com NF     │
                             └→ Pausa 1s (canceladas) ───────┘
```

### Quais status são cancelamento

Pergunta à Base (`getOrderStatusList`) em vez de cravar id. Todo status com
"cancel" no nome entra; os que também dizem "NF" ou "nota fiscal" vão para a
fila com NF, o resto (inclusive "Cancelado com Devolução") vai para Canceladas.

Id de status muda de conta para conta e ninguém lembra de voltar aqui no dia em
que mudar. Se nenhum status casar, o fluxo **para com erro** e o log lista todos
os status existentes — falha visível em vez de zero silencioso.

### O laço de páginas

`getOrders` devolve **no máximo 100 pedidos por chamada**. Uma leitura só traria
100 e calaria sobre o resto, então a varredura pagina por `id_from`: cada volta
pede os pedidos com id maior que o último recebido, e termina sozinha quando uma
página volta vazia (o nó Code devolve zero itens e nada segue adiante).

**Por que varre tudo em vez de só os ids novos:** cancelamento acontece *depois*
que o pedido foi criado. O pedido de terça cancelado hoje não é novo — o
cancelamento é. Olhar só a ponta da lista deixaria ele passar. Como a Base só
entrega os últimos 90 dias, "tudo" é uma janela fechada.

### Separar cancelamentos

O filtro de status é feito **no código**, não na chamada: o
`filter_order_status_id` da BaseLinker é ignorado em silêncio — devolve pedidos
de outro status como se tivesse funcionado (medido em 22/08/2026). Filtro que
falha calado é pior que filtro nenhum.

Também aplica o corte de ano (2026 em diante, o mesmo da tela) e traduz o
`order_source` para nome legível:

| `order_source` | Vira |
|---|---|
| `personal`, `omnik` | WHATSAPP |
| `shop` | LOJA INTEGRADA |
| `melibr` | MERCADO LIVRE |
| `shopeebr` | SHOPEE |
| `magalu` | MAGALU |

Origem fora da lista entra em maiúsculas como veio — a linha aparece, e o nome
esquisito na tela é o aviso de que falta uma entrada aqui.

### Registro que já existe **nunca** é regravado

Os dois GETs usam `?shallow=true`: o Firebase devolve só as chaves
(`{"canc_123": true}`), não os registros. É tudo que a comparação precisa, e
evita baixar a base inteira de hora em hora.

Chave que já existe é pulada. Isso não é economia, é correção: depois de criado,
o registro tem vida própria — alguém marca como concluída, o prazo corre, a
tarefa é gerada. Regravar por cima devolveria tudo para "a fazer" a cada rodada,
e a fila de ontem ressuscitaria toda hora.

### As duas gravações

`PATCH` em `reg/canceladas.json` e `PATCH` em `reg/canceladasNF.json`,
separadas.

**Não junte as duas num PATCH só em `reg.json`.** O PATCH do Firebase mescla
apenas no primeiro nível do corpo enviado: um `PATCH /reg.json` com
`{"canceladas": {…}}` substitui o nó `canceladas` inteiro pelo que foi mandado —
todos os cancelamentos anteriores somem. Cada coleção no seu próprio endereço, e
o merge acontece por registro.

---

## 4. O que ele **não** alcança

`getOrders` enxerga **90 dias** e nada além disso. Rodando em 23/08/2026, ele
chega até ~25/05/2026. Cancelamentos de **janeiro a maio de 2026 não vêm por
API** — estão no Arquivo, que é um banco separado da Base e não é alcançado por
nenhum parâmetro (o mesmo limite documentado em `base-pedidos-whatsapp.md` §9).

Para esses, o caminho é a exportação em CSV pelo painel da Base, como foi feito
com os 524 pedidos de WhatsApp.

---

## 5. Testar antes de ativar

1. Importe o fluxo e ligue as duas credenciais nos nós.
2. Deixe o Schedule **desligado** e clique em **Rodar agora (canceladas)**.
3. Leia o log do nó `Quais status são cancelamento`: ele imprime quais status a
   Base tem com "cancel" no nome, e de que lado cada um caiu. É aqui que se
   descobre um status escrito diferente do esperado.
4. Leia o log do nó `Separar cancelamentos` no fim da varredura: quantas
   páginas, quantos pedidos lidos, quantos cancelamentos novos, quantos já
   estavam.
5. Abra o LiveOps em **Pedidos → Canceladas** e **Canceladas com NF**: as linhas
   devem estar lá sem atualizar a página.
6. **Rode de novo.** O log tem que dizer `0 cancelamento(s) novo(s)` e a tela
   não pode mudar. Se mudar, pare e me chame antes de ativar.

Só depois disso ative o `A cada hora (canceladas)`.

---

## Quando algo não aparece

| Sintoma | Onde olhar |
|---|---|
| `401`/`403` na gravação | Escopos da credencial do Google, ou a chave privada colada pela metade |
| Erro "Não consegui ler os status" | Token da Base no Header Auth — Name tem que ser exatamente `X-BLToken` |
| Erro "Nenhum status com cancel no nome" | O log do nó lista os status da conta; algum está escrito de outro jeito |
| Nada é gravado e o log diz `0 novos` | Já estava tudo lá — é o comportamento certo |
| Linha aparece, tarefa não | Nenhum navegador aberto — a tarefa nasce quando alguém abre o sistema |
| Linha duplicada | Duas chaves para o mesmo pedido: confira se o número veio diferente entre as rodadas |
| Cancelamento de janeiro não veio | Limite de 90 dias — ver a seção 4 |
