# Rastreador Live — o fluxo do n8n

Cinco origens, um card. O que muda em relação ao fluxo antigo, o que
configurar, e o que sabemos que é frágil.

---

## 1. As cinco origens

O card tem o campo **Onde consultar**, que diz o sistema **e a conta**:

| Onde consultar | Como o robô pergunta | Id que o card usa |
|---|---|---|
| Melhor Envio · Antonio Carlos | API, credencial própria | Id na origem |
| Melhor Envio · Raphael | API, credencial própria | Id na origem |
| Manda Bem · Daniel | login no painel + leitura da página | nº da coleta |
| Manda Bem · 4Vita | login no painel + leitura da página | nº da coleta |
| Base (Mercado Livre, Shopee, Magalu) | API da BaseLinker | **Nº Pedido Base** |

O campo antigo se chamava "Intermediador" e guardava `Loggi MB`. Isso
misturava quem carrega com onde perguntar — e, com duas contas de cada, "MB"
deixou de identificar qualquer coisa. A consulta iria para a conta errada e
voltaria "não encontrado", que na tela parece problema do pacote.

Card sem origem definida **fica de fora da fila**, e o log da execução diz
quantos são. Ele não é consultado por engano em lugar nenhum: perguntar a um
sistema que não conhece o envio devolveria vazio, e vazio interpretado como
resposta viraria "sem movimento" — mentira pior que silêncio.

---

## 2. Por que os marketplaces entram pela Base

Sondamos a API da BaseLinker em 21/08/2026 e ela devolve o histórico do
pacote, com data e com o código de status da própria transportadora:

```
getOrderPackages           → package_id, courier_code, courier_package_nr
getCourierPackagesStatusHistory → [{ tracking_status_date, courier_status_code, tracking_status }]
```

Isso dispensou criar aplicativo no Mercado Livre, esperar aprovação da Shopee
e integrar o Magalu — três integrações viraram uma, com o token que já
existia.

**O limite, dito na cara:** a Base registra trocas de fase, não cada leitura
de código de barras. Não vai aparecer "chegou no centro de distribuição de
Cajamar". Nas três jornadas que conferimos:

```
Shopee Xpress    6 registros   ORDER_CREATED → PICKED_UP → DELIVERED
Mercado Envios   3 registros   ready_to_ship|dropped_off → shipped|out_for_delivery → delivered
Magalog          2 registros   shipped → delivered
```

O Mercado Envios é o mais detalhado; o Magalog, o mais pobre.

---

## 3. Dois detalhes que o teste com dado real cobrou

### O status vem do número, o log vem do texto

O `tracking_status` numérico é o mesmo entre as transportadoras — o texto
não. `DELIVERED`, `delivered` e `entregue` são o mesmo estado com três
grafias; o número é `5` nos três.

Então a tradução para a tela usa **o número**, e o log guarda **o texto
original**. Traduzir o log apagaria a informação de origem justamente no
lugar onde ela serve de prova.

| nº | card mostra |
|---|---|
| 0, 1 | Aguardando postagem |
| 2, 3 | Em trânsito |
| 4 | Saiu para entrega |
| 5 | Entregue |
| 6 | Devolvido · 7 Extraviado · 8 Cancelado |

### PICKED_UP quatro vezes não é movimento

O histórico da Shopee veio com `PICKED_UP` em quatro datas diferentes: é a
Base reconfirmando o mesmo estado a cada leitura, não o pacote andando. Sem
tratar, o card mostraria quatro linhas dizendo a mesma coisa.

O fluxo colapsa repetição consecutiva e mantém a **primeira** — que é quando
o pacote entrou naquele estado.

---

## 4. Só grava o que mudou

Rodando de cinco em cinco minutos, regravar tudo encheria o Firebase de
escrita inútil e faria a tela piscar sozinha o dia inteiro. Antes de gravar,
o fluxo compara o status e o log inteiro com o que já está no card.

Conferido na simulação com os dados reais:

```
1ª rodada         mudou = true    grava
2ª rodada igual   mudou = false   não grava
3ª com novidade   mudou = true    grava
origem sem resposta  mudou = false   não mexe no status
```

O log é **reconstruído** a cada rodada, não acrescentado: a fonte da verdade
é a transportadora. Assim uma correção dela chega ao card, em vez de ficar
enterrada sob a nossa cópia antiga.

---

## 5. A tarefa na data prevista

Ramo separado, roda junto com a consulta:

- previsão chegou (hoje ou antes) **e** o pacote não está entregue
  → cria tarefa em Tarefas Diárias para **quem cadastrou o rastreio**,
    prioridade alta, pedindo para conferir a baixa na Base;
- grava `trackTarefaCriada` no card, e é essa marca que impede a mesma
  cobrança de voltar a cada cinco minutos.

Rastreio cadastrado antes de 21/08/2026 não tem `criadoPorKey` — o card só
guardava o nome, e nome não identifica usuário. Esses aparecem no log da
execução e não geram tarefa. Os novos já nascem com a chave.

---

## 6. Credenciais (cinco)

| Nome no n8n | Tipo | Conteúdo |
|---|---|---|
| `Melhor Envio · Antonio Carlos` | Header Auth | Name `Authorization` · Value `Bearer <token>` |
| `Melhor Envio · Raphael` | Header Auth | Name `Authorization` · Value `Bearer <token>` |
| `Base (BaseLinker)` | Header Auth | Name `X-BLToken` · Value o token *(já existe)* |
| Manda Bem Daniel | — | não é credencial, ver abaixo |
| Manda Bem 4Vita | — | não é credencial, ver abaixo |

**Os tokens do Melhor Envio precisam de um escopo só: `shipping-tracking`.**
Os que temos hoje carregam `shipping-checkout`, `shipping-generate` e
`users-write` — um token com `shipping-checkout` compra etiqueta, ou seja,
gasta dinheiro da conta. Vale gerar dois novos marcando só o rastreio.

**As senhas do Manda Bem ficam dentro dos nós `Login Daniel` e
`Login 4Vita`**, no corpo do POST. O n8n não injeta credencial dentro de
corpo de requisição. A consequência prática: **ao exportar este fluxo, as
senhas vão junto.** Apague antes de mandar o JSON para alguém.

---

## 7. O que é frágil, e por quê

**Manda Bem não tem API.** O fluxo abre a tela de login, pega o `_token` do
Laravel, envia usuário e senha, guarda o cookie e lê o HTML do painel. Isso
funciona até o dia em que eles mudarem a página — e nesse dia para de
funcionar sem avisar. Por isso o leitor de movimentações **levanta erro
quando não reconhece nenhuma linha** num HTML grande: lista vazia pareceria
"pacote sem movimento", e não é.

**Cada card falha sozinho.** Todos os nós estão com `continueRegularOutput`:
um envio que não existe mais no Melhor Envio não derruba a rodada dos outros
trinta.

**Entregue sai da fila.** E pacote parado há mais de 45 dias também: ele não
volta a andar porque perguntamos de novo. Vira problema humano.
