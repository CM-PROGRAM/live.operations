# Pedidos da Base (BaseLinker) → LiveOps

Como os pedidos com canal **WhatsApp** saem da Base e aparecem na sub-aba
**Pedidos → Pedidos Base WhatsApp**.

---

## 1. O que a Base é, para efeito de integração

O painel que a equipe usa é o **BaseLinker** (`panel-u.baselinker.com`). Ele
tem API própria, documentada, com um endpoint só:

```
POST https://api.baselinker.com/connector.php
Cabeçalho:  X-BLToken: <token da conta>
Corpo (form-urlencoded):
  method=getOrders
  parameters={"date_confirmed_from":1787000000,"get_unconfirmed_orders":true}
```

A resposta vem em JSON, com `status: "SUCCESS"` e a lista em `orders`.

> Confirme os nomes exatos dos parâmetros na documentação da própria
> BaseLinker antes de ligar em produção. O desenho abaixo não muda; o que
> pode mudar é o nome de um campo ou outro.

---

## 2. O que precisamos de vocês (três coisas)

### 2.1 O token da API

No painel: **menu do usuário (canto superior direito) → Configurações da
conta → API**. Ali se gera o token.

O token **não vem para o repositório nem para o `index.html`** — este projeto
é publicado no GitHub Pages, e qualquer chave colada lá fica à vista de quem
abrir o código-fonte da página. Ele vive numa credencial do n8n, como o
Melhor Envio.

### 2.2 Qual origem de venda é o "WhatsApp"

A Base separa os pedidos por **origem** (`order_source` / `order_source_id`).
Marketplace tem origem própria; venda feita à mão costuma cair em "pessoal",
e é aí que o WhatsApp normalmente vive — com um nome que vocês escolheram.

Para descobrir o identificador certo, o método é `getOrderSources`. O que eu
preciso saber é: **qual nome aparece na Base para os pedidos do WhatsApp**.
Sem isso, filtrar por canal é chute — e chute aqui significa trazer pedido de
marketplace para dentro de uma aba que diz WhatsApp.

### 2.3 De quando para cá

Puxar o histórico inteiro é caro e quase sempre inútil. Digam a data de
início (ex.: 01/07/2026) e daí em diante a leitura é incremental.

---

## 3. Por que não dá para o LiveOps chamar a Base direto

Dois motivos, e nenhum deles se resolve com jeitinho:

1. **O token ficaria exposto.** Chamada do navegador leva a chave no código
   da página. Quem abrir o site tem acesso à conta inteira da Base.
2. **CORS.** A API da BaseLinker não autoriza chamada vinda de outro
   endereço no navegador — o mesmo motivo pelo qual a consulta de CPF passa
   pelo Apps Script.

Então a leitura é feita **de fora**, por quem já faz esse papel aqui:

- **n8n** (recomendado) — já está de pé, já tem a credencial do Firebase e o
  hábito de rodar de hora em hora. É o mesmo desenho do Live Track.
- **Apps Script** — funciona, mas hoje ele é síncrono e serve a conferência
  de vendas e o CPF; empilhar mais um trabalho pesado ali é pedir para os
  três ficarem lentos juntos.

---

## 4. O caminho, ponta a ponta

```
[Schedule 1h]
      │
[HTTP POST api.baselinker.com/connector.php · getOrders]
      │        X-BLToken (credencial do n8n)
      │        parameters = {"date_confirmed_from": <último lido>, ...}
      │
[Code: só o que é WhatsApp]   ── filtra por order_source_id / order_source
      │                          e traduz para o formato do LiveOps
      │
[HTTP PATCH no Firebase]      ── suplelive/reg/pedidosBase/<id>.json
      │
[Wait 2s] → próxima página (a Base devolve 100 por vez)
```

O LiveOps não pergunta nada à Base: ele lê o Firebase, que já é a fonte de
tudo no sistema. O card aparece na tela no mesmo instante, em todos os
navegadores abertos — como acontece com tarefas e rastreios.

---

## 5. O formato que a integração precisa gravar

Um registro por pedido, em `suplelive/reg/pedidosBase/<id>`:

| campo            | exemplo                                              | observação |
|---|---|---|
| `id`             | `base_46659426`                                      | prefixo evita colidir com outras listas |
| `numero`         | `46659426`                                           | nº do pedido na Base |
| `externo`        | `W-8812`                                             | nº no canal, quando houver |
| `cliente`        | `ALFREDO ALVES DA SILVA`                             | |
| `telefone`       | `27999987802`                                        | só dígitos, com DDD |
| `valor`          | `219.90`                                             | número, não texto |
| `status`         | `Pago`                                               | status como está na Base |
| `canal`          | `WhatsApp`                                           | o que motivou a inclusão |
| `data`           | `2026-08-18`                                         | AAAA-MM-DD, para ordenar e filtrar |
| `hora`           | `09:12`                                              | |
| `link`           | `https://panel-u.baselinker.com/orders.php#order:46659426` | abre o pedido no painel |
| `sincronizadoEm` | `18/08/2026, 01:00`                                  | quando a integração leu |
| `_by`            | `n8n`                                                | impede o eco da própria gravação |

A tela é **somente leitura**: quem manda no pedido é a Base. Corrigir pedido
é lá — se a tela pudesse editar, os dois lados passariam a discordar e
ninguém saberia qual está certo.

---

## 6. O que já está pronto

- A sub-aba **Pedidos → Pedidos Base WhatsApp** existe, com busca, filtro por
  status, contadores do dia e da semana, e o link para abrir cada pedido na
  Base.
- A lista `pedidosBase` já sincroniza registro a registro, como as vendas —
  a integração pode gravar de hora em hora sem atropelar quem está na tela.
- Enquanto não houver integração, a aba diz exatamente o que falta em vez de
  ficar vazia sem explicação.

Falta só o que depende de vocês: **token**, **nome da origem WhatsApp** e
**data de início**.
