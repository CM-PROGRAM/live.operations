# Estoque — o catálogo da Base no LiveOps

A tela de Estoque é espelho do catálogo da Base: SKU, nome, EAN, saldo por
armazém e custo médio. **Somente leitura.** Quem move estoque é a Base — um
segundo lugar onde dá para mexer é um segundo lugar onde a conta diverge, e
aí ninguém sabe qual está certa.

---

## 1. Sim, precisa de fluxo no n8n

Pelo mesmo motivo dos pedidos, e vale repetir porque a pergunta volta: **o
navegador não pode falar com a Base.** Duas razões, cada uma suficiente
sozinha.

A API da BaseLinker não libera chamada de página web (CORS) — o navegador
recusa antes de sair. E o token precisaria estar dentro do `index.html`, que
mora num repositório **público**: qualquer pessoa leria o token e teria a
nossa Base inteira na mão.

O n8n roda no servidor, guarda o token na credencial `Base (BaseLinker)` que
já existe, e escreve no Firebase. O LiveOps só lê o Firebase. É o mesmo
caminho dos pedidos, com a mesma credencial.

Arquivo: **`docs/n8n-base-estoque-workflow.json`**, 11 nós.

---

## 2. O caminho

```
Começar a leitura  ─┐
A cada 4 horas     ─┴→ Base · armazéns → Base · catálogos → De onde começar
                            ↓
      Base · página de produtos → Ids da página → Base · dados dos produtos
                            ↓
                     Montar produtos ─┬→ Gravar a página
                                      └→ Pausa 1s → Base · página de produtos
```

Três coisas dessa forma, e não de outra:

**O nome do armazém vem antes de tudo.** O estoque de cada produto chega com
a chave do armazém (`bl_1`, `shop_3`), não com o nome. Sem o mapa, a tela
mostraria `bl_1` para a equipe — que não significa nada para ninguém. Chave
fora do mapa aparece como veio **e é anotada no log**: errar caladinho é o
que não pode.

**A página vazia encerra o laço.** O n8n não tem "pare aqui"; quem para é a
ausência de item. `Ids da página` devolve zero itens quando a Base não manda
mais produto, e a execução termina sozinha.

**Dois ramos saindo de `Montar produtos`.** Um grava, o outro segue para a
próxima página levando o número dentro do item. Ler um contador de um nó que
já rodou trinta vezes foi o que quebrou a carga histórica dos pedidos; aqui
o número viaja junto e não há o que confundir.

---

## 3. O formato que o fluxo grava

Em `suplelive/reg/produtos/<id>`:

```
id            "prod_<id do produto na Base>"
sku           código interno                     ex "AST12840"
nome          nome do produto
ean           código de barras — TEXTO, sempre
total         soma das quantidades, número
armazens      [{nome:"Estoque SP", qtd:3}, ...]
precoMedio    custo médio unitário — ou null
link          URL do produto no painel da Base
sincronizadoEm  quando a leitura rodou
_by           "n8n"
```

**EAN é texto e nunca número.** Ele começa com zero, e número come o zero:
`"07897570128400"` viraria `7897570128400` e não bate mais com a etiqueta.

**O `total` vem pronto do fluxo, a tela não soma.** Se um dia a leitura
deixar de trazer um armazém, somar o que chegou daria um total menor que o
verdadeiro — e ninguém perceberia. O total é responsabilidade de quem leu.

---

## 4. O campo do custo médio ainda não está confirmado

É a única coisa deste fluxo que não pôde ser conferida contra a conta antes
de escrever: a rede daqui não alcança a Base. E depois do que o
`filter_order_status_id` fez com a gente — parâmetro ignorado em silêncio,
devolvendo dado como se o filtro tivesse funcionado —, cravar um nome de
campo e torcer não é opção.

Então o nó `Montar produtos` **procura**, entre os nomes plausíveis:

```
average_cost · average_landed_cost · purchase_price
cost_price   · average_purchase_price
```

Usa o primeiro que existir e **diz no log qual foi**. Se nenhum existir, o
preço fica nulo, a tela mostra um traço — que é a verdade — e o log despeja
os campos que o produto realmente tem, para acertarmos o nome de uma vez.

Depois da primeira execução, é só ler o log do nó `Ids da página`:

```
fim da varredura — 326 produtos gravados em 4 páginas | custo médio lido do campo "average_cost"
```

ou, se não achou:

```
... | NENHUM campo de custo médio encontrado — ver o log de "Montar produtos"
```

---

## 5. Valor em estoque: o que entra e o que fica de fora

O cartão **Valor Total** soma `saldo × custo médio` **só de quem tem os
dois**. Produto com saldo e sem custo entraria como zero e faria o total
parecer menor do que é — pior que não contar, porque sumiria do valor sem
aparecer em lugar nenhum. Quando existe esse caso, o próprio cartão diz
quantos ficaram de fora.

Saldo negativo também não vira valor. Negativo não é "pouco estoque": é
conta que não fecha. Ele aparece em vermelho na lista, para saltar.

---

## 6. Rodar

1. Importar `docs/n8n-base-estoque-workflow.json` no n8n
2. Conferir as credenciais: `Base (BaseLinker)` nos quatro nós da Base e
   `Firebase (conta de serviço)` em `Gravar a página` — as duas já existem,
   são as mesmas do fluxo de pedidos
3. **Execute workflow** e deixar rodando até parar sozinho
4. Abrir o log de `Ids da página` e ler duas coisas: quantos produtos
   entraram, e de qual campo saiu o custo médio

De hora em hora não adianta: catálogo muda menos que pedido. O gatilho vem
em **4 horas**, e o manual fica ao lado para quando alguém quiser agora.
