# Orçamento por SKU — Base + site

Como o quadro **Orçamentos** (Vendas → WhatsApp → Atendimento) descobre o
produto e o preço a partir de um SKU.

---

## 1. Por que passa pelo Apps Script

Dois motivos, os mesmos da consulta de CPF e da leitura de pedidos:

1. **O token da Base ficaria exposto.** Chamada feita pelo navegador leva a
   chave no código da página, e este projeto é publicado no GitHub Pages —
   qualquer pessoa que abrir o código-fonte teria a conta inteira.
2. **CORS.** Nem a BaseLinker nem a loja autorizam chamada vinda de outro
   endereço no navegador.

Então quem busca é o servidor do Google:

```
tela  →  Apps Script  →  Base (qual produto é este SKU)
                      →  site (por quanto ele está sendo vendido)
```

---

## 2. O que configurar (uma vez)

Em **Extensões → Apps Script → Configurações do projeto → Propriedades do
script**, acrescente:

| Propriedade | Valor | Obrigatória |
|---|---|---|
| `BASELINKER_TOKEN` | o token da conta da Base | sim |
| `SITE_BUSCA_URL` | endereço de busca do site, com `{sku}` no lugar do termo | só se o padrão não servir |
| `BASE_INVENTARIO_ID` | id do catálogo na Base | só se a conta tiver mais de um |

> **Cuidado:** *acrescente* uma linha nova. Renomear uma propriedade
> existente apaga a antiga — foi assim que o `CHATWOOT_TOKEN` sumiu uma vez.

O padrão de `SITE_BUSCA_URL` é:

```
https://www.suplelive.com.br/busca?q={sku}
```

Se a busca da loja usa outro caminho, é aqui que se corrige — sem
republicar o código.

Depois de salvar, **Implantar → Gerenciar implantações → editar → Nova
versão**. Sem isso o que está no ar continua sendo o código antigo.

---

## 3. Conferir se está funcionando

Abra no navegador, trocando o SKU:

```
<URL do /exec>?acao=produto&sku=SEU-SKU&diag=1
```

O `diag=1` devolve o caminho inteiro:

```json
{
  "ok": true,
  "sku": "SUP-001",
  "nome": "Creatina Monohidratada 300g",
  "preco": 110,
  "origem": "json-ld",
  "url": "https://www.suplelive.com.br/busca?q=SUP-001",
  "passos": {
    "base": { "achou": true, "id": "12345", "nome": "Creatina..." },
    "site": [ { "url": "...", "status": 200, "preco": 110, "origem": "json-ld", "tamanho": 84213 } ]
  }
}
```

Sem o `diag=1`, "não achei o SKU" não diz se o problema foi a Base, o
endereço de busca ou o formato da página — e a investigação vira tentativa e
erro.

---

## 4. De onde sai o preço

A leitura tenta as formas mais estáveis primeiro:

| Ordem | Onde | `origem` | Confiança |
|---|---|---|---|
| 1 | JSON-LD (`"offers":{"price":…}`) | `json-ld` | alta — quase toda plataforma publica isso para o Google |
| 2 | `<meta property="product:price:amount">` / `itemprop="price"` | `meta` | alta |
| 3 | primeiro `R$ 00,00` do texto | `texto (palpite)` | **baixa** |

O terceiro caminho é um palpite e a tela avisa quando ele foi usado: numa
página em promoção o primeiro `R$` costuma ser o **preço riscado**, e o
orçamento sairia com o número errado sem ninguém perceber.

Se a origem vier como palpite com frequência, mande uma URL de produto do
site que eu escrevo o parser exato daquela loja.

---

## 5. Enquanto não estiver configurado

O campo **Preço do site** continua aberto para digitar à mão, e todo o resto
do fluxo — quantidade, desconto progressivo, frete, textos de PIX e Cartão —
já funciona. A tela não fica refém de uma integração que ainda não subiu.
