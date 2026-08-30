# API REST do LiveOps (v1)

A porta para o mundo de fora: planilha, script, parceiro, ferramenta de
BI — qualquer coisa que precise ler ou gravar dados do LiveOps sem ser o
próprio sistema nem um fluxo do n8n. Vive no worker da Cloudflare (o
mesmo `liveops-imagens`), a partir da versão **v14**.

Endereço base:

```
https://liveops-imagens.carlosmagnoav94.workers.dev/api/v1
```

Toda escrita segue a disciplina da migração: grava no banco D1, repassa
ao Firebase enquanto a convivência durar, e avisa a sala de tempo real —
quem estiver com o LiveOps aberto vê a mudança na hora.

---

## Publicar (uma vez)

1. **Colar o worker v14**: worker `liveops-imagens` → **Edit code** →
   apagar tudo → colar `cloudflare/worker-imagens/worker.js` → **Deploy**.
   Conferir no navegador: `/saude` precisa responder **`ok v14`**.
2. **Deixar o worker reconhecer o master** (para administrar chaves pelo
   painel do LiveOps): worker → **Settings** → **Variables and Secrets** →
   **Add** → variável **`MASTER_CHAVE`** com o usuário do master
   (`cmandrade`). Sem isso, o painel pede a chave do robô — que fica
   guardada só no navegador do master.

Nada mais precisa ser criado: a tabela de chaves nasce sozinha no
primeiro uso, e cada parceiro ganha a sua chave pelo painel.

## Cada parceiro, uma chave

No LiveOps: **Administrador → Segurança → 🔌 Parceiros & API**.

Em "Novo parceiro" você dá um nome, marca **quais recursos** aquele
parceiro enxerga e decide se ele **pode escrever**. A chave aparece
**uma única vez** — o worker guarda apenas o SHA-256 dela, então nem
você nem ninguém a recupera depois; perdida, revoga-se e cria-se outra.

Por que uma chave por parceiro, e não uma só para todos:

- **Revogar um não derruba os outros.** Parceiro que sai, ou chave que
  vazou, morre sozinha com um clique.
- **Escopo.** A transportadora vê `rastreios` e mais nada; o contador lê
  `pedidos` e `vendas` sem poder escrever em lugar nenhum.
- **Rastro.** Todo registro gravado pela API carrega `_apiPor` com o nome
  do parceiro e `_apiEm` com a hora — "de onde veio isto?" tem resposta.
- **Uso à vista.** O painel mostra último uso e número de chamadas de
  cada chave.

O parceiro manda a chave no cabeçalho `X-LiveOps-Chave` de cada chamada.
Um teto de **600 chamadas por minuto** por chave segura laço desgovernado
(responde `429` acima disso).

### Mandar a chave ao parceiro

Canal seguro, nunca e-mail aberto nem grupo de mensagem. Combine também
o básico com ele: qual escopo tem, que a chave é dele e intransferível, e
que qualquer suspeita de vazamento é motivo de revogar na hora — a
substituição leva um minuto.

### Administração por linha de comando (alternativa ao painel)

```bash
ROBO='SUA_CHAVE_ROBO'
API='https://liveops-imagens.carlosmagnoav94.workers.dev/api/v1'

# Criar
curl -s -X POST "$API/chaves" -H "X-LiveOps-Chave: $ROBO" \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Transportadora XYZ","recursos":["rastreios"],"escrever":true}'

# Listar (nunca devolve os segredos)
curl -s "$API/chaves" -H "X-LiveOps-Chave: $ROBO"

# Revogar
curl -s -X DELETE "$API/chaves/k7x2m9" -H "X-LiveOps-Chave: $ROBO"
```

## Autenticação

| Operação | Quem pode |
|---|---|
| Ler (`GET`) | chave de parceiro (dentro do escopo dela) **ou** o login de uma pessoa do sistema |
| Escrever (`POST/PATCH/PUT/DELETE`) | **só** chave de parceiro com escrita liberada |
| Administrar chaves | só o master (`MASTER_CHAVE`/`MASTER_UID` ou a `CHAVE_ROBO`) |

O segredo `CHAVE_API`, se existir no worker, continua valendo como chave
mestra de acesso total — útil para uma integração sua, não para parceiro.

## Recursos

`GET /api/v1` lista todos. Hoje:

| Recurso | O que é |
|---|---|
| `pedidos` | pedidos vindos da Base (BaseLinker) |
| `tarefas` | tarefas da Central (atividades) |
| `produtos` | catálogo da Base |
| `vendas` | vendas registradas pelo WhatsApp |
| `rastreios` | envios ao cliente |
| `devolucoes` | tarefas de devolução |
| `atendimentos` | retornos de atendimento |
| `acompanhamentos` | compras, devoluções e transferências |
| `leads` | contatos digitados em Clientes |
| `templates` | templates de mensagem do WhatsApp |
| `entradas` | entradas de estoque |
| `entradas-estoque` | fila de entrada executada pelo n8n |
| `canceladas` / `canceladas-nf` | vendas canceladas (sem e com NF) |
| `projetos` | projetos |

## Rotas

```
GET    /api/v1                      → lista os recursos
GET    /api/v1/<recurso>            → página de registros
GET    /api/v1/<recurso>/<id>       → um registro
POST   /api/v1/<recurso>            → cria (o id é gerado e volta na resposta)
PATCH  /api/v1/<recurso>/<id>       → altera só os campos enviados
PUT    /api/v1/<recurso>/<id>       → substitui o registro (cria se não existir)
DELETE /api/v1/<recurso>/<id>       → remove
```

Parâmetros de listagem:

| Parâmetro | Faz o quê |
|---|---|
| `?limite=100` | tamanho da página (máx 1000) |
| `?depois=<id>` | cursor: continua de onde a página anterior parou (`proxima` na resposta) |
| `?desde=<ts>` | só o que mudou depois desse timestamp (ms) — ideal para sincronizar |
| `?ultimos=1` | o fim da lista em vez do começo (os registros mais novos) |

Formato de resposta da lista:

```json
{ "ok": true, "recurso": "pedidos",
  "itens": [ { "id": "abc", "ts": 1756500000000, "dados": { … } } ],
  "proxima": "abc" }
```

`proxima` vem `null` na última página.

## Exemplos (curl)

```bash
CHAVE='CHAVE_DO_PARCEIRO'   # lo_xxxxxx_...
BASE='https://liveops-imagens.carlosmagnoav94.workers.dev/api/v1'

# Os pedidos mais recentes
curl -s "$BASE/pedidos?ultimos=1&limite=20" -H "X-LiveOps-Chave: $CHAVE"

# Um pedido específico
curl -s "$BASE/pedidos/42894204" -H "X-LiveOps-Chave: $CHAVE"

# O que mudou na última hora (sincronização incremental)
curl -s "$BASE/tarefas?desde=$(( ($(date +%s) - 3600) * 1000 ))" -H "X-LiveOps-Chave: $CHAVE"

# Criar uma tarefa
curl -s -X POST "$BASE/tarefas" -H "X-LiveOps-Chave: $CHAVE" \
  -H 'Content-Type: application/json' \
  -d '{"titulo":"Conferir nota do pedido 123","status":"aberta","prioridade":"alta"}'

# Alterar só um campo
curl -s -X PATCH "$BASE/tarefas/atv_abc123" -H "X-LiveOps-Chave: $CHAVE" \
  -H 'Content-Type: application/json' -d '{"status":"concluida"}'
```

## Limites e comportamento

- Registro individual: até **900 KB**. Página: até **1000** itens.
- `POST` deixa o Firebase inventar a chave primeiro (repasse antes da
  gravação), para os dois bancos ficarem com o **mesmo id** — igual aos
  robôs do n8n. Se o Firebase não responder, um id `api…` é gerado aqui.
- O campo `firebase` nas respostas de escrita conta como foi o repasse
  (`ok`, `sem-credencial`, `http-4xx`…). Depois do desligamento do
  Firebase ele deixa de importar.
- Todo registro gravado pela API leva `_apiPor` (nome do parceiro) e
  `_apiEm` (quando) — o rastro de quem escreveu o quê.
- Erros voltam sempre como `{"erro":"motivo"}` com o status HTTP certo:
  `401` sem chave/login, `403` fora do escopo ou chave só-leitura,
  `404` não achado, `413` grande demais, `429` ritmo excedido,
  `400` pedido malformado.

## O que a API não faz (de propósito)

- **Imagens, pacotes de estado, sala e login** têm rotas próprias
  (`/img`, `/dados`, `/rt`, `/auth`) — a API REST é só dos registros.
- **Usuários e permissões não são expostos.** Isso é assunto do painel
  Administrador, com o master, e não de integração externa.
