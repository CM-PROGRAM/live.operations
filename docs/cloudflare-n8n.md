# Migração para a Cloudflare — Etapa 3: os robôs do n8n

## O problema que ela resolve

Os fluxos do n8n gravam **direto no Firebase**. Enquanto for assim, o que
eles trazem — pedidos da Base, rastreios, canceladas, entradas de estoque,
inbox do WhatsApp — não chega ao espelho da Cloudflare por conta própria.
Quem abrisse o sistema pela Cloudflare (modo `preferir`) não veria a venda
nova entrar.

*(Uma tampa provisória já está no ar: a sessão que recebe um registro do
Firebase manda uma cópia para o espelho. Funciona enquanto alguém estiver
com o sistema aberto no modo normal — não serve como solução final, e é
por isso que esta etapa existe.)*

## A solução: o worker vira o carteiro

O fluxo entrega no worker, e o **worker** guarda na Cloudflare **e**
repassa para o Firebase. Com isso:

- cada nó do n8n muda **uma coisa só**: o começo da URL;
- nada é acrescentado a nenhum fluxo — nem nó, nem lógica;
- no dia de desligar o Firebase, apaga-se o repasse **no worker**, e
  nenhum fluxo precisa ser tocado de novo;
- quem já usa o sistema pela Cloudflare vê o pedido novo na hora, porque
  o worker avisa a sala de tempo real a cada gravação.

As rotas imitam o Firebase de propósito — mesmo caminho, mesmo `.json` no
fim, mesmo `?shallow=true`, mesma resposta (inclusive o `{"name":"..."}`
do POST). O nó do n8n não percebe a troca.

---

## Parte 1 — na Cloudflare (uma vez)

### 1. Colar o worker atualizado

Worker `liveops-imagens` → **Edit code** → apagar tudo → colar
`cloudflare/worker-imagens/worker.js` → **Deploy** → conferir `/saude`.

### 2. Criar os três segredos

Worker → **Settings** → **Variables and Secrets** → **Add** → tipo
**Secret** (não "Text" — segredo não fica à mostra):

| Nome | Valor |
|---|---|
| `CHAVE_ROBO` | uma senha longa inventada por você (30+ caracteres, letras e números). É o que os fluxos vão apresentar |
| `FB_SA_EMAIL` | o e-mail da conta de serviço: `firebase-adminsdk-fbsvc@suplelive-8a700.iam.gserviceaccount.com` |
| `FB_SA_KEY` | a **chave privada** dessa mesma conta de serviço (o bloco que começa com `-----BEGIN PRIVATE KEY-----`) |

Os dois últimos são a credencial que o n8n já usa hoje — é ela que
permite ao worker repassar a gravação ao Firebase. Se você não tiver o
arquivo à mão: Firebase Console → Configurações do projeto → Contas de
serviço → **Gerar nova chave privada** (baixa um `.json`; o e-mail está
em `client_email` e a chave em `private_key`).

> Sem `FB_SA_EMAIL`/`FB_SA_KEY` o worker ainda funciona: guarda na
> Cloudflare e responde `"firebase":"sem-credencial"`. Só que aí o
> Firebase para de receber — e quem ainda lê de lá fica sem o pedido novo.
> Configure os dois **antes** de trocar os fluxos.

### 3. Testar antes de mexer em qualquer fluxo

Num terminal (ou no Postman), trocando `SUA_CHAVE`:

```
curl -X PATCH "https://liveops-imagens.carlosmagnoav94.workers.dev/robo/reg/rastreios/teste-migracao.json" \
  -H "X-LiveOps-Chave: SUA_CHAVE" -H "Content-Type: application/json" \
  -d "{\"teste\":true}"
```

Resposta esperada: `{"ok":true,"gravadas":1,"firebase":"ok"}` — o `"ok"`
no fim é a prova de que o repasse chegou ao Firebase. Depois:

```
curl "https://liveops-imagens.carlosmagnoav94.workers.dev/robo/reg/rastreios/teste-migracao.json" \
  -H "X-LiveOps-Chave: SUA_CHAVE"
```

E para limpar o teste, o mesmo endereço com `-X DELETE`.

---

## Parte 2 — no n8n

### 1. Uma credencial nova

**Credenciais** → **Criar** → tipo **Header Auth**:

- **Nome**: `LiveOps (chave do robô)`
- **Name**: `X-LiveOps-Chave`
- **Value**: a mesma senha que você pôs em `CHAVE_ROBO`

### 2. Em cada nó: trocar o endereço e a credencial

Em todo nó da lista abaixo:

1. **URL** — troque só o começo:
   - de `https://suplelive-8a700-default-rtdb.firebaseio.com/suplelive/`
   - para `https://liveops-imagens.carlosmagnoav94.workers.dev/robo/`
   - **o resto da URL fica idêntico**, inclusive o `.json` e o `?shallow=true`
2. **Autenticação** — troque a credencial `Firebase (conta de serviço)`
   (Google Service Account) por `LiveOps (chave do robô)` (Header Auth).

Nada mais muda: método, corpo, expressões `{{ }}`, tudo igual.

### Situação em 29/08/2026

Migrados e rodando em produção (URL trocada + credencial `LiveOps (chave
do robô)`), todos confirmados com `"firebase":"ok"` na execução:

| Fluxo | Nós | Confirmação |
|---|---|---|
| Base → LiveOps · Catálogo e estoque | 1 | 613 produtos gravados |
| #1(CM) LiveOps → Pedidos Base WhatsApp | 2 | execução verde a cada minuto |
| #1(CM) LiveOps → Integração ChatWoot (WhatsApp) | 2 | mensagem real de ponta a ponta |
| #1(CM) LiveOps → Pedidos Base Canc. & Canc. com NF | 4 | 48 registros em cada gravação |

Adiados a pedido do master — **os projetos não seguiram e serão
retomados depois**. Não existem mais (ou estão parados) no n8n, então
não há o que migrar hoje; no dia de retomá-los, trocar os nós ANTES de
ligar, senão voltam a gravar direto no Firebase:

- `LiveOps · Live Track (rastreio de hora em hora)` — 2 nós
- `LiveOps → Base · Entrada de estoque` — 2 nós
- `LiveOps · Rastreador Live` — 4 nós (fluxo desativado no n8n)
- `LiveOps · Carga histórica de pedidos (rodar na mão)` — 2 nós

**Com isso a etapa 3 está concluída**: todo fluxo que roda hoje grava
pelo worker. Nada mais escreve direto no Firebase, a não ser o repasse
que o próprio worker faz — e é esse repasse que se apaga no dia de
desligar o Firebase, sem tocar em fluxo nenhum.

Fluxo em que a exportação de `docs/` ficou para trás: a **Integração
ChatWoot** cresceu bastante (ganhou envio, contato, nova conversa e
busca). Os nós novos falam com o Chatwoot, não com o Firebase — a regra
que vale para achar o que migrar é sempre a mesma: **só o nó cuja URL
contém `firebaseio.com`**.

### Os 19 nós, fluxo por fluxo

| Fluxo | Nó | Método | Caminho (depois de `/robo/`) |
|---|---|---|---|
| Pedidos da Base | O que já temos | GET | `reg/pedidosBase.json` |
| Pedidos da Base | Gravar no LiveOps | PATCH | `reg/pedidosBase/{{ $json.chave }}.json` |
| Carga histórica | O que já temos | GET | `reg/pedidosBase.json` |
| Carga histórica | Gravar a página | PATCH | `reg/pedidosBase.json` |
| Base estoque | Gravar a página | PATCH | `reg/produtos.json` |
| Entrada de estoque | Ler a fila | GET | `reg/entradasEstoque.json` |
| Entrada de estoque | Escrever no LiveOps | PATCH | `reg/entradasEstoque/{{ $json.chave }}.json` |
| Live Track | Ler Live Track | GET | `reg/rastreios.json` |
| Live Track | Gravar no LiveOps | PATCH | `reg/rastreios/{{ $json.chave }}.json` |
| Rastreador Live | Ler Live Track | GET | `reg/rastreios.json` |
| Rastreador Live | Gravar no LiveOps | PATCH | `reg/rastreios/{{ $json.chave }}.json` |
| Rastreador Live | Criar tarefa no LiveOps | POST | `atividadesExternas.json` |
| Rastreador Live | Marcar tarefa criada | PATCH | `reg/rastreios/{{ ... }}.json` |
| Cancelados | Canceladas já gravadas | GET | `reg/canceladas.json?shallow=true` |
| Cancelados | Com NF já gravadas | GET | `reg/canceladasNF.json?shallow=true` |
| Cancelados | Gravar canceladas | PATCH | `reg/canceladas.json` |
| Cancelados | Gravar canceladas com NF | PATCH | `reg/canceladasNF.json` |
| Inbox Chatwoot | Gravar conversa | PATCH | `inbox/conv/{{ $json.convId }}.json` |
| Inbox Chatwoot | Gravar mensagem | PUT | `inbox/msg/{{ $json.convId }}/{{ $json.msgId }}.json` |

### 3. Um fluxo de cada vez

Não troque os oito de uma vez. Faça **um**, execute à mão, confira que:

- a execução ficou verde e a resposta traz `"firebase":"ok"`;
- o registro aparece no sistema como sempre apareceu.

Só então passe ao próximo. Assim, se algo estranhar, você sabe exatamente
onde foi — e o remédio é colar de volta a URL antiga naquele nó.

---

## Como voltar atrás

Em qualquer nó, a qualquer momento: troque a URL de volta para
`https://suplelive-8a700-default-rtdb.firebaseio.com/suplelive/…` e a
credencial de volta para `Firebase (conta de serviço)`. Nada se perde — o
que já foi gravado está nos dois lugares.

## O que o worker recusa de propósito

- Apagar ou substituir uma lista inteira (`PUT`/`DELETE` na coleção):
  nenhum fluxo precisa, e um engano ali levaria a operação junto.
- Caminho fora de `reg/`, `inbox/` e `atividadesExternas`: a chave do robô
  não abre imagem, pacote de estado nem a sala.
- Registro maior que ~900 KB, ou lote com mais de 400 registros.

## Depois desta etapa

| Etapa | O quê | Situação |
|---|---|---|
| 1 | Imagens no R2 | ✅ em produção |
| 2 | Espelho de todos os dados | ✅ em produção |
| 4 | Sala de tempo real + leitura pela Cloudflare | ✅ no ar, ligada por navegador |
| 3 | Robôs do n8n (este documento) | ✅ worker pronto — falta a troca nos fluxos |
| 5 | Login próprio e **desligar o Firebase** | a última |

Com a etapa 3 concluída e a equipe no modo `preferir`, **nada mais lê do
Firebase**: ele passa a ser só um destino de cópia, e desligá-lo vira o
gesto pequeno que ele deve ser.
