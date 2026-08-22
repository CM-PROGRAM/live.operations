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

### 2.2 Qual origem de venda é o "WhatsApp" — ✅ confirmado

O `getOrderSources` da conta, rodado em 18/08/2026, devolveu:

```
personal   0       → WhatsApp     ← o nosso
personal   32409   → SP
shop       8005077 → LI (4VITA 0001) · 8005285 → Atacado
amazon, melibr, shopeebr, magaluopenapi, raiadrogasil,
viavarejo, omnik, tiktokbr, webcontinental → marketplaces
```

O filtro usa o **par** `order_source = "personal"` **e** `order_source_id = 0`.
Travar os dois não é preciosismo: existe outra origem manual na mesma família
(`SP`, id 32409), e filtrar só por "personal" traria os pedidos dela para
dentro de uma aba que diz WhatsApp.

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
| `cpf`            | `12345678909`                                        | vem do `invoice_nip`; é a chave da aba Clientes |
| `email`          | `cliente@email.com`                                  | quando houver |
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

---

## 7. O fluxo do n8n

`docs/n8n-base-pedidos-workflow.json` — sete nós:

```
[A cada 1 hora] → [Janela de leitura] → [Status da Base] → [Pedidos da Base]
                                                                  │
                                        [Só WhatsApp] ────────────┘
                                              │
                                     [Gravar no LiveOps]

[Origens de venda (rodar uma vez)]   ← desligado; serve para descobrir o nome
```

**Credencial**: uma só, do tipo *Header Auth*, chamada `Base (BaseLinker)`,
com **Name** = `X-BLToken` e **Value** = o token. O token não fica em nenhum
arquivo — nem aqui, nem no `index.html`.

### Tempo real

O gatilho roda **de minuto em minuto**, e não de hora em hora: a equipe
precisa ver o pedido assim que ele entra. Isso é barato porque a chamada já
vai filtrada por origem — são duas requisições por volta, contra um limite de
100 por minuto.

Existe também um gatilho **por webhook** (`/webhook/base-pedidos`). Cadastrando
essa URL na Base (Configurações da conta → Webhooks) nos eventos de pedido, a
leitura acontece no instante do pedido, sem esperar o próximo minuto. O
gatilho de tempo continua ligado como rede de segurança: webhook perdido não
volta sozinho.

Do LiveOps para a tela já era instantâneo — o card aparece assim que o
registro chega ao Firebase, em todos os navegadores abertos. A demora estava
só no trecho Base → Firebase.

### Só grava o que mudou

Rodando a cada minuto, regravar tudo a cada volta encheria o Firebase de
escrita inútil e faria a tela piscar sozinha o dia inteiro. Antes de gravar, o
fluxo lê o que já está no LiveOps e compara campo a campo — ignorando o
carimbo de sincronização, senão todo pedido "mudaria" sempre.

Se a leitura do Firebase falhar, ele grava tudo: melhor escrever demais do que
perder uma atualização por causa de uma leitura que não respondeu.

### Por que uma janela e não paginação

A Base devolve no máximo 100 pedidos por chamada. Em vez de montar um laço de
páginas — mais nós, mais coisa para quebrar sem ninguém perceber — a leitura
relê os últimos 7 dias a cada minuto e regrava por cima. Regravar não custa:
a gravação é por id, então o pedido só sobrescreve a si mesmo.

Se uma rodada trouxer 100 pedidos, o log avisa: aí a janela precisa encurtar,
senão os mais antigos ficam de fora em silêncio.

Para trazer o histórico na primeira vez, aumente `DIAS` no nó *Janela de
leitura*, rode à mão quantas vezes precisar, e devolva para 3.

### A origem, travada

No nó **Só WhatsApp**, `ORIGEM_WHATSAPP = { fonte: 'personal', id: '0' }`.
Se um dia criarem outra origem manual e quiserem incluí-la, é aqui que se
mexe — rodando o nó *Origens de venda* antes, para pegar o id certo.

### Status e valor

- O status vem como número na Base; o fluxo busca a lista de status uma vez
  por rodada e grava o nome.
- O total não vem pronto: é a soma dos produtos mais o frete. Somar no fluxo
  evita que a tela mostre um valor diferente do que a Base mostra.

---

## 8. A aba Vendas → Clientes

A base de clientes **não é uma segunda lista**: é a leitura destes mesmos
registros, agrupados por pessoa. Manter duas listas significaria decidir,
toda vez que divergissem, qual das duas está certa — e elas divergem sempre.
Assim o cliente aparece no mesmo instante em que o pedido cai no Firebase,
sem nenhum passo a mais na automação.

A chave do agrupamento é o **CPF**; sem CPF, o **telefone**; sem os dois, o
nome. Nessa ordem porque é a ordem da confiança: cliente troca de telefone e
escreve o nome de três jeitos, mas o CPF é um só.

Por isso o `cpf` passou a ser gravado. Ele vem do campo `invoice_nip` do
pedido na Base. Pedido sem NIP preenchido continua entrando — só cai para o
agrupamento por telefone.

---

## 9. A carga histórica

Arquivo: `docs/n8n-base-carga-historica.json` — fluxo separado, **gatilho
manual**, para rodar uma vez.

Ele é separado do fluxo de todo dia de propósito. O de todo dia lê uma janela
curta a cada minuto; varrer o histórico inteiro a cada minuto seria um
desperdício e um risco de bater no limite da API.

### 9.1 Como ele varre

`getOrders` devolve no máximo **100 pedidos por chamada**, então uma janela
larga traria 100 e calaria sobre o resto. A varredura pagina por `id_from`:
cada volta pede os pedidos com id maior que o último recebido, e o laço
termina sozinho quando uma página volta vazia.

Página que volta vazia devolve **zero itens**, e sem item nada segue adiante —
é assim que o laço para, sem precisar de um nó de decisão que alguém possa
configurar errado.

### 9.2 Por que ela lê tudo e filtra depois

O fluxo de todo dia filtra a origem no servidor (`filter_order_source`), e faz
bem: economiza tráfego. A carga faz o contrário — lê **todos** os pedidos e
separa o WhatsApp dentro do código. Dois motivos:

1. **Filtro errado não dá erro.** Se o id da origem estiver trocado, a Base
   devolve lista vazia e a carga terminaria "com sucesso" tendo importado
   zero. Lendo tudo, isso não acontece calado — e o log mostra quantos vieram
   de cada origem, com o nome que a Base usa.

2. **Dá para medir o Arquivo** (ver 9.3).

### 9.3 O Arquivo — o que a Base entrega, e o que não entrega

**Medido em 22/08/2026, não deduzido.** O pedido mais antigo que o
`getOrders` devolve nesta conta é de **24/05/2026** — exatamente **90 dias**
antes. Duas sondagens fecharam a questão:

| Sondagem | Resultado |
|---|---|
| `getOrders` com `date_from` de 01/01/2026 | devolve o mesmo pedido de 24/05 |
| `getOrders` com `id_from: 1` | devolve o mesmo pedido de 24/05 |

Pedir por data antiga não muda nada. **Não é parâmetro faltando: a Base
arquiva o pedido depois de 90 dias e o `getOrders` não devolve arquivado.**
O limite é da conta, não da chamada.

Para trazer o que está no Arquivo (**Pedidos → Lista de Pedidos → Arquivo**)
sobram dois caminhos, e nenhum passa por esta carga:

1. **Mexer no arquivamento automático da Base**, se ele for configurável para
   um prazo maior. Isso resolve daqui para a frente; o que já foi arquivado
   continua arquivado até ser desarquivado.
2. **Exportar o Arquivo pela tela da Base em CSV** e trazer por importação.
   É o caminho que funciona hoje.

### Uma medição que foi removida

A primeira versão desta carga tentava medir o tamanho do Arquivo contando os
`order_id` que faltavam na sequência. **Não serve, e o número que ela dava era
enganoso.** Os ids da BaseLinker são globais — de todos os clientes dela, não
sequenciais por conta. Nesta conta o pedido mais antigo tem id 36 milhões e os
recentes passam de 47 milhões: 11 milhões de "buracos" para ~4.700 pedidos em
90 dias. Aqueles buracos são pedidos de outras empresas.

O log agora informa apenas **a data do pedido mais antigo alcançado**, que é
uma verdade verificável e responde a mesma pergunta sem inventar número.

### 9.4 Rodar

1. Importar o arquivo no n8n
2. Conferir as credenciais: `Base (BaseLinker)` nos dois nós da Base e
   `Firebase (conta de serviço)` nos dois do LiveOps
3. **Execute workflow** e deixar rodando
4. Abrir o nó `Página → registros` e ler o log

Rodar de novo é seguro: pedido que já está igual no LiveOps não é regravado.
Numa carga de milhares isso é a diferença entre alguns minutos e uma hora — e
evita que a tela de quem estiver trabalhando pisque a cada página.

