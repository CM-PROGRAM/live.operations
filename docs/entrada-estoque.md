# Entrada de estoque — do LiveOps para a Base

Matheus e Carlos lançam a mercadoria que chegou. A tela monta o pedido e põe
na fila; quem mexe na Base é o n8n. Substitui, no nosso sistema, o que hoje
os fluxos `Plataforma - Sincronizar Estoque` e `Plataforma - Subir estoque
produtos novos` fazem por dentro do Supabase.

---

## 1. Avaliação dos dois fluxos existentes

O que eles fazem, em uma frase cada: o **Sincronizar** copia o catálogo da
Base para o Supabase (produtos e kits, estoque por armazém, preços, custo
médio); o **Subir estoque** pega as compras já conferidas (`is_verified` e
`is_in_stock = false`), procura o SKU na Base, recalcula estoque e custo
médio, escreve com `addInventoryProduct` e avisa por WhatsApp / cria tarefa
no Coda.

A lógica de negócio está certa e foi ela que copiamos. O que segue são os
defeitos encontrados na leitura, em ordem de gravidade.

### 1.1 O token da Base está em texto puro

Repetido em **todos** os nós HTTP dos dois arquivos. Qualquer export, print
ou anexo entrega a Base inteira — e não só para ler: `addInventoryProduct`
altera estoque e preço.

Correção: mover para uma credencial Header Auth (o `X-BLToken` vira valor da
credencial) e **trocar o token**, porque o atual já circulou.

### 1.2 Saldo negativo zera o custo do produto

No `Code1` do Subir estoque:

```js
total_cost = (current_stock * current_avg_cost) + (added_quantity * added_cost);
new_avg_price = total_cost / new_estoque;
```

Com saldo **−5**, custo médio 100, e uma compra de 10 a 50:

```
(-5 × 100) + (10 × 50) = -500 + 500 = 0
0 / 5 = 0          → o produto passa a valer zero no estoque
```

Não é hipótese: o catálogo tem produto com saldo negativo. Quando o saldo
atual não é positivo, o único custo confiável é o desta compra.

### 1.3 Preço base pode ficar negativo

```js
new_base_price = (preco_ml * 0.88) - 19.95;
```

Abaixo de **R$ 22,67** o resultado é negativo, e `Number(x) || 0` não salva
(−11,15 é um número válido). Preço negativo entra na Base e vai para o
marketplace.

### 1.4 No arquivo enviado, o fluxo não roda

O nó `Supabase` (o `getAll` de `purchase_products`) **não está ligado a
nada** na saída, e o `If` seguinte não recebe de ninguém. `Redis1` e `Redis7`
também estão órfãos, e `Coda`, `Wait` e `Evolution API1` estão desativados.
Vale conferir se a versão que está rodando no servidor é essa mesma.

### 1.5 Coisas menores, que ainda mordem

- `is_bundle ?? "bibi"` e `sku ?? "bibi"` — sobra de depuração. Produto sem
  SKU é gravado com o SKU `"bibi"`.
- Sem paginação em `getProductsList` / `getInventoryProductsList`. Com 326
  produtos funciona; passando de mil, corta em silêncio.
- `$items("Edit Fields")[0]` dentro do laço usa índice fixo. Funciona porque
  o lote é 1; quem aumentar o lote quebra tudo sem erro nenhum.
- IDs de armazém (`bl_43152`, `bl_45090`) e de tabela de preço (`33907`,
  `41014`) cravados no código, em vários lugares.

---

## 2. O nosso caminho

```
LiveOps (tela)  →  Firebase: suplelive/reg/entradasEstoque
                        ↓
                   n8n lê a fila, uma entrada por vez
                        ↓
                   Base: procura o SKU, lê saldo e custo,
                         calcula, addInventoryProduct
                        ↓
                   escreve de volta o que aconteceu
                        ↓
LiveOps mostra: lançado / sem cadastro / erro, com os números
```

O Firebase faz o papel do Supabase deles. Nada mais muda de conceito.

### 2.1 Por que a tela não calcula

O custo médio depende do saldo e do custo que a Base tem **no instante do
lançamento**, e a tela só conhece a última leitura do catálogo — que pode ter
horas. Calcular aqui e mandar pronto gravaria um custo errado com cara de
certo.

Então a tela mostra uma **previsão**, escrita como previsão, e a conta que
vale é feita no fluxo com o saldo do momento.

### 2.2 Uma entrada por execução

Duas entradas do mesmo SKU em paralelo leriam o mesmo saldo antigo, e a
segunda escreveria por cima da primeira: **o estoque somaria uma compra só.**
A Base não tem "soma isso aqui", só "o estoque agora é X" — então ler e
escrever precisa acontecer em fila. O gatilho roda de 5 em 5 minutos e leva a
mais antiga.

### 2.3 Três desfechos, não dois

| situação | o que é | o que a tela faz |
|---|---|---|
| **Lançado** | a Base confirmou | mostra estoque e custo, antes → depois |
| **Sem cadastro na Base** | o SKU não existe lá | botão **Refazer**, depois de cadastrar |
| **Erro** | a Base recusou, ou o armazém sumiu | mostra o motivo, botão **Refazer** |

"Sem cadastro" não é erro: é outra coisa e pede outra ação — alguém precisa
cadastrar o produto na Base. O fluxo antigo mandava WhatsApp pedindo isso;
aqui a situação fica na tela de quem lançou, com o motivo escrito.

**Refazer cria um pedido novo, nunca reabre o antigo.** Um lançamento que
falhou pode ter falhado *depois* de mexer na Base, e reprocessar o mesmo
registro somaria a quantidade duas vezes.

### 2.4 O que corrigimos em relação ao original

- **Saldo negativo**: quando o saldo atual não é positivo, o custo médio novo
  é o custo desta compra. O log marca o caso com `⚠`.
- **Preço negativo**: preço calculado que não seja positivo é descartado e o
  preço antigo permanece. O log diz que descartou e por quê.
- **Campo vazio é "não mexe"**, e nunca vira zero — produto com preço zero
  vai para o marketplace de graça.
- **IDs de armazém e de tabela de preço saem do dado**, não do código. O
  pedido guarda o *nome* do armazém ("Estoque ES"), que é o que a equipe
  conhece; a tradução para `bl_43152` é feita na hora. Nome que não existir
  mais na Base para o lançamento com motivo, em vez de lançar no lugar errado.
- **Só marca "lançado" se a Base confirmou.** Escrever sucesso a partir de
  uma resposta que não veio `SUCCESS` deixaria a mercadoria fora do estoque
  com o pedido marcado como resolvido — e ninguém volta a olhar o que está
  resolvido.

---

## 3. Rodar

1. Importar `docs/n8n-entrada-estoque-workflow.json` (15 nós)
2. Credenciais: `Base (BaseLinker)` nos quatro nós da Base e
   `Firebase (conta de serviço)` nos dois do LiveOps — as duas já existem
3. Ativar. O gatilho é de 5 em 5 minutos; o manual fica ao lado
4. Antes disso, rodar o fluxo do catálogo
   (`n8n-base-estoque-workflow.json`) pelo menos uma vez: é dele que saem a
   lista de SKUs e a de armazéns do formulário

O botão **+ Entrada de estoque** aparece para o master e para quem tem a
permissão `entrada`.

---

## 4. O que ainda não fazemos

**Cadastrar produto novo direto do LiveOps.** Hoje, SKU que não existe na
Base vira "sem cadastro" e alguém cadastra lá. Dá para criar pelo mesmo
`addInventoryProduct` sem `product_id`, mas produto novo precisa de nome,
EAN, categoria, fotos e descrição — e um cadastro pela metade na Base é pior
que nenhum, porque ele já começa a aparecer nos marketplaces. Se for para
fazer, é uma tela própria, não um campo a mais neste formulário.
