# n8n → LiveOps: Canceladas e Canceladas com NF

Como fazer o n8n ler os pedidos cancelados na Base (Baselinker) e criar sozinho
a solicitação no LiveOps. A tarefa em Tarefas Diárias o próprio sistema gera —
o n8n grava **um único registro** e para por aí.

---

## Como funciona por baixo

O LiveOps guarda cada solicitação num nó separado do Firebase:

```
suplelive/reg/canceladas/<id>       ← aba Canceladas
suplelive/reg/canceladasNF/<id>     ← aba Canceladas com NF
```

Todo navegador aberto escuta essas duas árvores. Assim que um registro aparece:

1. o card aparece na aba, sem ninguém atualizar a página;
2. o sistema percebe que a solicitação não tem tarefa e cria a tarefa diária,
   com Gustavo e CM Andrade como responsáveis e prazo de 24h;
3. os dois recebem a notificação, atribuída a quem consta em `criadoPor`.

O id da tarefa é derivado do id da solicitação (`atv_canc_<id>`), então dois
navegadores abertos ao mesmo tempo geram exatamente o mesmo registro — não
duplica.

**Por que o n8n não cria a tarefa também:** as regras (quem é responsável, o
prazo, o texto das considerações) ficam num lugar só, dentro do sistema. Se um
dia mudarem, muda no LiveOps e o n8n continua igual.

---

## Passo 1 — Credencial do Firebase no n8n

O n8n vai gravar no Firebase como **conta de serviço**. Conta de serviço tem
acesso total ao banco e **não passa pelas regras de segurança** — ou seja, não é
preciso mexer nas regras que já estão publicadas.

1. Firebase Console → engrenagem → **Configurações do projeto** → aba **Contas de serviço**
2. **Gerar nova chave privada** → baixa um `.json`
3. No n8n: **Credentials** → **New** → `Google Service Account API`
   - **Service Account Email**: o campo `client_email` do json
   - **Private Key**: o campo `private_key` do json (cole inteiro, com as linhas
     `-----BEGIN PRIVATE KEY-----` e `-----END PRIVATE KEY-----`)
   - Ligue **Set up for use in HTTP Request node**
   - **Scopes**:
     ```
     https://www.googleapis.com/auth/firebase.database
     https://www.googleapis.com/auth/userinfo.email
     ```

> Guarde o `.json` fora do repositório. Quem tem esse arquivo escreve em
> qualquer lugar do banco.

---

## Passo 2 — Ler os cancelados na Base

Nó **HTTP Request**:

- **Method**: `POST`
- **URL**: `https://api.baselinker.com/connector.php`
- **Headers**: `X-BLToken: <seu token da Base>`
- **Body** (form-urlencoded):
  - `method` = `getOrders`
  - `parameters` = `{"status_id": 330390, "date_confirmed_from": {{ $now.minus(1, 'hours').toSeconds() }}}`

`330390` é o status **Canceladas com NF** (é o id que já aparece no link do
painel). Para a aba **Canceladas** use o id do outro status — dá para conferir
na URL do filtro dentro do painel da Base.

A resposta vem em `orders[]`. Os campos que interessam:

| Campo na Base | Vira no LiveOps |
|---|---|
| `order_id` | `pedidoBase` e o id do registro |
| `invoice_fullname` (ou `delivery_fullname`) | `cliente` |
| `invoice_nip` | `cpf` |
| `phone` | `telefone` |
| `order_source` | `plataforma` |

> Confirme qual campo carrega o CPF na sua conta. Em contas brasileiras costuma
> ser `invoice_nip`, mas pode estar num campo extra (`extra_field_1`).

---

## Passo 3 — Montar o registro

Nó **Code** (rode uma vez por item):

```js
// Nomes das plataformas: precisam bater com a lista do LiveOps
const MAPA = {
  'shopee suplenium'      : 'SHP SUPLENIUM',
  'shopee primevitaminas' : 'SHP PRIMEVITAMINAS',
  'mercado livre vitalife': 'M.L VITALIFE',
  'mercado livre vxshop'  : 'M.L VXSHOP',
  'magalu 4vita'          : 'MAGALU 4VITA',
  'magalu vixsupps'       : 'MAGALU VIXSUPPS',
  'drogaria sao paulo'    : 'DROG. S. PAULO',
  'drogaria pacheco'      : 'DROG. PACHECO',
  'web continental'       : 'WEB CONTINENTAL',
  'rd marketplace'        : 'RD MARKETPLACE',
  'loja integrada'        : 'LOJA INTEGRADA'
};

const p = $json;
const bruto = String(p.order_source || '').toLowerCase().trim();
const plataforma = MAPA[bruto] || '';   // vazio = revisar o mapa

const agora = Date.now();
const prefixo = 'canc_';                // 'cancnf_' no fluxo de Canceladas com NF

return {
  json: {
    id           : prefixo + p.order_id,
    pedidoBase   : String(p.order_id),
    cliente      : p.invoice_fullname || p.delivery_fullname || '',
    cpf          : p.invoice_nip || '',
    telefone     : p.phone || '',
    plataforma   : plataforma,
    consideracoes: 'Entrar em contato com o cliente e fazer o estorno da NF caso necessário',
    responsaveis : ['gustavo', 'cmandrade'],
    prazoHoras   : 24,
    prazoLimite  : agora + 24 * 3600 * 1000,
    status       : 'aberta',
    criadoEm     : new Date().toLocaleDateString('pt-BR'),
    criadoPor    : 'Base (n8n)',
    criadoPorKey : 'n8n',
    ordemManual  : agora
  }
};
```

Três detalhes que importam:

- **`id` = `canc_` + o número do pedido.** É o que impede duplicata: se o fluxo
  rodar de novo e pegar o mesmo pedido, ele grava por cima do mesmo registro em
  vez de criar outro card.
- **O `id` não pode ter `.`, `#`, `$`, `/`, `[` ou `]`** — são caracteres
  proibidos em chave do Firebase.
- **Não mande o campo `_by`.** É como o sistema reconhece o que veio de fora.

### Valores aceitos em `plataforma`

```
LOJA INTEGRADA · SHP SUPLENIUM · SHP PRIMEVITAMINAS · M.L VITALIFE
M.L VXSHOP · MAGALU 4VITA · MAGALU VIXSUPPS · DROG. S. PAULO
DROG. PACHECO · WEB CONTINENTAL · RD MARKETPLACE
```

Se o mapa devolver vazio, o card ainda aparece — só fica sem plataforma. Vale
pôr um nó de aviso (e-mail, Slack) quando `plataforma` sair em branco, para o
mapa não envelhecer em silêncio.

---

## Passo 4 — Gravar no LiveOps

Nó **HTTP Request**:

- **Method**: `PUT`
- **URL**:
  ```
  https://suplelive-8a700-default-rtdb.firebaseio.com/suplelive/reg/canceladas/{{ $json.id }}.json
  ```
  Para a outra aba, troque `canceladas` por `canceladasNF`.
- **Authentication**: `Predefined Credential Type` → `Google Service Account API` → a credencial do Passo 1
- **Send Body**: ligado, **Body Content Type**: `JSON`
- **Specify Body**: `Using JSON` → `{{ JSON.stringify($json) }}`

`PUT` grava o registro inteiro naquela chave. Rodou duas vezes com o mesmo
pedido, sobrescreve — não vira card repetido.

---

## Passo 5 — Agendar

Um **Schedule Trigger** de hora em hora resolve. Combine a janela do
`date_confirmed_from` com o intervalo do agendamento (1 hora de busca para 1
hora de intervalo, com uma folga) para não perder pedido na virada.

---

## Testando

1. Rode o fluxo com o Schedule desligado, num pedido cancelado só.
2. Firebase Console → Realtime Database → confira que apareceu em
   `suplelive/reg/canceladas/canc_<pedido>`.
3. Abra o LiveOps: o card deve aparecer em **Vendas → Canceladas** sem atualizar
   a página, e a tarefa em **Tarefas Diárias** logo depois.
4. Rode o mesmo fluxo de novo: tem que continuar **um** card.

## Quando algo não aparece

| Sintoma | Onde olhar |
|---|---|
| `401`/`403` no nó de gravação | Escopos da credencial, ou a chave privada colada pela metade |
| `400 invalid key` | O `id` tem `.`, `#`, `$`, `/`, `[` ou `]` |
| Card aparece, tarefa não | Nenhum navegador aberto — a tarefa nasce quando alguém abre o sistema |
| Card duplicado | O `id` está variando entre execuções (não use `Date.now()` no id) |
| Plataforma em branco | Falta a entrada no `MAPA` do Passo 3 |
