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

### 9.3 O Arquivo — respondido pela própria Base

A tela **Pedidos → Lista de pedidos → Arquivo** avisa, em letras próprias:

> Pedidos com mais de 3 meses vão automaticamente para o Arquivo para fins de
> otimização do sistema. **O arquivo é um banco de dados separado e tem seu
> próprio mecanismo de busca.** [...] Para restaurar seu pedido ao status
> ativo, clique em "Desarquivar" no cartão de pedido.

Isso encerra a investigação:

- **3 meses** é exatamente o que a sondagem mediu em 22/08/2026: o pedido mais
  antigo que o `getOrders` devolve é de 24/05/2026, 90 dias antes.
- O Arquivo é **outro banco**. Não é status, não é filtro — por isso nenhum
  parâmetro do `getOrders` o alcança. Nunca foi falta de parâmetro.
- Desarquivar é **um pedido por vez**, pelo cartão. Com 12.857 pedidos no
  Arquivo, isso não é caminho.

### O que foi tentado, e por que não serviu

| Tentativa | Resultado |
|---|---|
| `getOrders` com `date_from` de 01/01/2026 | devolve o mesmo pedido de 24/05 |
| `getOrders` com `id_from: 1` | devolve o mesmo pedido de 24/05 |
| `getOrders` com `filter_order_status_id` do status "Whatsapp" | **ignorado** — voltaram pedidos com outro `order_status_id`, e o mesmo primeiro pedido da chamada sem filtro |
| `getOrders` com `order_id` de um pedido ARQUIVADO (01/09/2026) | `status: SUCCESS`, `orders: []` — **a quarta e última porta** |

A quarta foi testada em 01/09/2026, com a sonda `n8n-sonda-arquivo.json`, e
é a que encerra o assunto: **busca direta pelo número também não alcança**. A
Base responde SUCCESS e devolve lista vazia para um pedido que está no
Arquivo e aparece na tela dela. Não é varredura, não é filtro, não é
intervalo — é o pedido exato, pelo id, e não vem. O Arquivo é outro banco, e
a API de pedidos não o enxerga de nenhuma forma.

A terceira merece nota, porque é a armadilha desta API: **parâmetro que a
BaseLinker não reconhece não dá erro** — ela devolve dados como se o filtro
tivesse funcionado. Um filtro decorativo no fluxo passaria despercebido para
sempre. É por isso que nada aqui foi decidido pelo nome do parâmetro, e sim
pelo que voltou.

Nota sobre o status chamado "Whatsapp" (id 354653): ele **não** marca origem.
Os pedidos que o carregam vêm de `omnik`, `melibr` (Mercado Livre) e
`shopeebr` (Shopee). Classificar WhatsApp por ele traria marketplace junto.

### O caminho que sobra

Exportar o Arquivo pela tela da Base, **filtrando antes pela origem do
WhatsApp** — sem o filtro seriam 12.857 pedidos, com ele são algumas
centenas. A importação a construir é de **pedido**, não de cliente: os
clientes se montam sozinhos a partir dos pedidos, com valor, data e histórico
corretos. Um importador de cadastro deixaria todo cliente antigo com R$ 0,00 e
estragaria o Total Gasto e o RFM.

### Uma medição que foi removida

A primeira versão desta carga tentava medir o tamanho do Arquivo contando os
`order_id` que faltavam na sequência. **Não serve, e o número era enganoso.**
Os ids da BaseLinker são globais — de todos os clientes dela, não sequenciais
por conta. Nesta conta o pedido mais antigo tem id 36 milhões e os recentes
passam de 47 milhões: 11 milhões de "buracos" para ~4.700 pedidos em 90 dias.
Aqueles buracos são pedidos de outras empresas.

O log informa agora **a data do pedido mais antigo alcançado** — verdade
verificável, que responde a mesma pergunta sem inventar número.

### 9.4 Rodar

1. Importar o arquivo no n8n
2. Conferir as credenciais: `Base (BaseLinker)` nos dois nós da Base e
   `Firebase (conta de serviço)` nos dois do LiveOps
3. **Execute workflow** e deixar rodando
4. Abrir o nó `Página → registros` e ler o log

Rodar de novo é seguro: pedido que já está igual no LiveOps não é regravado.
Numa carga de milhares isso é a diferença entre alguns minutos e uma hora — e
evita que a tela de quem estiver trabalhando pisque a cada página.


---

## 10. O importador do Arquivo

Botão **Importar Arquivo** em Pedidos, visível só para o master. Lê o CSV
exportado pelo modelo `LiveOps · Pedidos WhatsApp` e grava em `pedidosBase`,
os mesmos registros que o n8n escreve — com `doArquivo: true`, porque esse
pedido não volta a ser lido (a API não alcança o Arquivo) e fica congelado.

### 10.1 O modelo de exportação

Base → **Pedidos → Imprimir e exportar**, tipo CSV, português, com **só a
seção "Pedido" marcada** — marcar "Produto" faz o pedido de vários itens
repetir SKU e nome dentro da linha, e as colunas deixam de bater.

Seção `[RAIZ]`:

```
numero;data;cliente_entrega;cliente_comprador;cpf;telefone;email;valor_pedido;preco_frete;itens_produtos;itens_total;status;origem
[PEDIDOS]
```

Seção `[PEDIDOS]`:

```
"[numero_do_pedido]";"[data_compra]";"[nome_sobrenome_entrega]";"[nome_sobrenome_comprador]";"[CPF_CNPJ_comprador]";"[telefone_cliente]";"[email_cliente]";"[valor_pedido]";"[preco_frete]";"[contagem_produtos_pedido]";"[contagem_total_itens]";"[nome_status]";"[nome_fonte_pedido]"
```

`[valor_pedido]` **já inclui o frete** — conferido no pedido 47264387:
`price_brutto 158,99 × 1` + `delivery_price 19,77` = `178,76`, igual ao
`payment_done`. O `preco_frete` entra em coluna própria só para consulta; o
total do LiveOps é o `valor_pedido` sozinho, senão o frete conta duas vezes.

### 10.2 Três coisas que o arquivo real cobrou

**A exportação pode vir sem quebra de linha.** No arquivo de 22/08/2026 os
524 pedidos vieram grudados numa linha só, depois do cabeçalho. Por isso o
leitor acha registro **por formato** — treze campos entre aspas separados por
ponto e vírgula — e não por linha. Com quebra de linha o mesmo padrão vale, e
não é preciso reexportar quando ela falta.

Se sobrar qualquer coisa fora dos registros, o importador **para**: isso
significa aspas dentro de um campo, e aí o alinhamento das colunas não é
confiável. Gravar torto é pior que não gravar.

**Telefone nem sempre é telefone.** Seis registros traziam nome ou e-mail
digitado no campo, e três vinham com 14 dígitos. O que não fecha em 12 ou 13
dígitos com `55` na frente vira vazio, e o pedido cai no nome na hora de
agrupar. Vazio é honesto; telefone inventado gruda dois clientes.

**CPF de recheio.** Um mesmo CPF apareceu em 18 pedidos de 13 pessoas
diferentes, e junto dele um telefone em 16 pedidos de 11 pessoas — é o que o
atendente digita quando o cliente não passa o dado. Como o CPF é a primeira
chave do agrupamento, isso criaria um cliente com 18 compras que não existe, e
o Total Gasto e o RFM de quem olhasse seriam ficção.

A defesa está em `_cliChavesDeRecheio`, no agrupamento — não no importador,
porque o mesmo lixo pode chegar pelo n8n. A regra é de formato: **a mesma
chave sob três ou mais nomes distintos não agrupa nada** e some da ficha. Não
há CPF fixo no código, por dois motivos: CPF real não entra em arquivo
público, e lista fixa envelhece no dia em que alguém adotar outro número de
recheio. O corte em três é folgado — no arquivo medido nenhuma chave tinha
entre 3 e 11 nomes: casal e família param em dois, o recheio saltou para doze.

### 10.3 Nada é gravado direto

O importador lê, conta e mostra: quantos leu, quantos já existem, quantos vão
entrar, a soma com e sem cancelados, o período, e quantos vêm sem telefone,
sem CPF e sem e-mail. Só grava depois que alguém clica.

Reimportar o mesmo arquivo é seguro: pedido já existente pelo número não é
tocado, e repetido dentro do próprio arquivo entra uma vez só.

### 10.4 O que entrou

Carga de 22/08/2026, os 524 pedidos do Arquivo com origem WhatsApp:

```
período           26/06/2025 a 22/05/2026
soma              R$ 190.739,08   (R$ 178.286,77 sem os 10 cancelados)
sem telefone      45      sem CPF 18      sem e-mail 47
clientes gerados  376     maior deles com 10 pedidos
```

O n8n alcança de 24/05/2026 em diante. **Não há sobreposição** — os dois se
encaixam sem duplicar pedido nenhum.

---

## 11. O painel de Pedidos

Cinco números no topo, um bloco de busca e filtros, e a lista.

```
Em andamento   nem entregue nem cancelado — "Enviado", "Pago", "Pedidos Antigos"
Concluídos     entregue/concluído/finalizado, com o nº de cancelados embaixo
Receita total  soma sem os cancelados
Ticket médio   receita ÷ pedidos que valem
Sem telefone   não dá para chamar no WhatsApp
```

Os KPIs são sempre sobre a base inteira, **nunca sobre o filtro**: número de
painel que muda quando alguém digita na busca não serve para decidir nada.

O estado sai do **texto** do status, não de um id, porque o texto é o que a
Base manda e ele muda conforme o canal. O que não é nem entregue nem
cancelado fica em "em andamento" — chamar de concluído seria inventar um
desfecho que a Base não afirmou.

### 11.1 As duas colunas derivadas

**2ª Compra** — este pedido é a segunda compra da pessoa, ou uma depois dela.
**Recompra** — a pessoa voltou a comprar *depois* deste pedido.

As duas saem do mesmo agrupamento da aba Clientes, então o CPF e o telefone
de recheio já ficaram de fora (§10.2). **Pedido cancelado não conta como
compra** — nem para virar "2ª", nem para valer como recompra de quem veio
antes: contar seria dizer que a pessoa comprou de novo justamente quando ela
desistiu. Ele continua na lista, só não mexe na contagem.

Os totais das duas colunas batem sempre, e não é coincidência: para um
cliente com *n* compras, são *n−1* pedidos que têm alguém antes e *n−1* que
têm alguém depois.

### 11.2 O que a tela não tem, e por quê

Não há **"Adicionar pedido"** nem **"Editar"**. Quem cria e corrige pedido é
a Base; um botão aqui abriria a porta para os dois lados discordarem e
ninguém saber qual está certo. As ações são **Ver cliente** e **Abrir na
Base** — ir olhar, não mexer.

Também não há caixa de seleção por linha. Selecionar serve para agir em lote,
e não existe ação em lote numa tela que não altera nada.

---

## 11. O fluxo único — todos os canais (01/09/2026)

`docs/n8n-base-pedidos-todos.json` substitui o fluxo de WhatsApp e a carga
histórica por um só. Menos fluxo no n8n era o pedido; o efeito colateral é
que existe **um** lugar para consertar quando a Base mudar de ideia.

### 11.1 O que mudou

**Nenhum filtro de origem.** O fluxo antigo pedia `personal/0` ao servidor.
Este lê tudo e nomeia cada pedido com o nome que a Base dá à loja — vindo do
`getOrderSources`, não de uma lista no código. Loja nova de Mercado Livre ou
Shopee entra sozinha, com o nome certo, sem ninguém vir editar nada. Loja que
a Base ainda não nomeou sai com o código (`melibr`), nunca vazia.

**Dois modos, um caminho.** O gatilho manual varre do `id_from: 0` — é a
carga completa. O agendado começa no menor id dos últimos 7 dias que já
temos: pega o pedido novo e relê o antigo que mudou de status, sem varrer o
catálogo inteiro de 15 em 15 minutos. Semana sem venda cai para 0 e varre
tudo, porque ler demais é melhor que ler de menos.

**Só grava o que mudou.** A comparação ignora o carimbo de sincronização,
senão todo pedido mudaria sempre. Numa passagem de 15 minutos isso é a
diferença entre algumas escritas de D1 e milhares.

**Grava na Cloudflare**, em `/robo/reg/pedidosBase.json` — não no Firebase,
que foi excluído em 31/08.

### 11.2 O Arquivo continua fora, e continua sendo por isto

A seção 9.3 acima mediu e a própria Base confirmou por escrito: pedido com
mais de 3 meses vai para o **Arquivo**, que é um **banco separado com busca
própria**. Nenhum parâmetro do `getOrders` chega lá — `date_from` de janeiro
e `id_from: 1` devolvem o mesmo pedido de 24/05/2026.

Isso não é limitação do fluxo, é da API. Um fluxo único não muda esse fato;
o que ele faz é deixar claro no log até onde chegou:

```
pedido mais antigo alcançado: 2026-06-03
```

Os anteriores entram pelo caminho da seção 10: exportar o Arquivo em CSV pela
tela da Base e usar **Importar Arquivo** na aba Pedidos. O importador já lê a
coluna `origem` e usa como canal — nunca foi só de WhatsApp. Para trazer
todos os canais, exportar **sem** filtrar a origem.

### 11.3 Rodar

1. Importar `n8n-base-pedidos-todos.json`
2. Credenciais: `Base (BaseLinker)` nos três nós da Base, `LiveOps (chave do
   robô)` nos dois do worker
3. **Execute workflow** uma vez — é a carga completa dos 3 meses
4. Ler o log de `Página → registros`: páginas, lidos, gravados, a data do
   mais antigo alcançado e a contagem por canal
5. Ativar o fluxo para o agendamento de 15 minutos valer

Depois disso, desligar os fluxos antigos de pedidos e de carga histórica.
