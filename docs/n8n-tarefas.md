# API externa: criar tarefa em Tarefas Diárias

Como o n8n (ou qualquer outro sistema) cria uma tarefa direto no LiveOps.
Grava-se **um registro** no Realtime Database e o card aparece na hora em
Tarefas Diárias, em todos os navegadores abertos.

---

## A chamada

- **Method**: `PUT`
- **URL**:
  ```
  https://suplelive-8a700-default-rtdb.firebaseio.com/suplelive/reg/atividades/{id}.json
  ```
- **Authentication**: conta de serviço do Firebase
  (`Google Service Account API`, escopos `firebase.database` e `userinfo.email`).
  Conta de serviço não passa pelas regras de segurança — não é preciso alterá-las.
- **Body**: o JSON abaixo.

O `{id}` da URL tem de ser **igual** ao campo `id` do corpo.

---

## O JSON

```json
{
  "id": "ext_20260812_0001",
  "titulo": "Integração",
  "skuTipo": "MLB",
  "sku": "MLB4038735524",
  "descricao": "Anúncio parado desde ontem. Conferir vínculo na Base.",
  "responsaveis": ["gustavo", "cmandrade"],
  "responsavel": "gustavo",
  "vencimento": "2026-08-12",
  "prioridade": "normal",
  "status": "aberta",
  "criadoEm": "12/08/2026",
  "criadoPor": "Base (n8n)",
  "criadoPorKey": "n8n",
  "ordemManual": 1786550000000
}
```

Esse é o conjunto completo do que o sistema usa ao criar uma tarefa pela tela.
Nada além disso é necessário.

---

## Os campos

| Campo | Obrigatório | O que aceita |
|---|---|---|
| `id` | sim | Texto único. **Não pode ter** `.` `#` `$` `/` `[` `]`. Use algo derivado da origem (nº do pedido, id do chamado) para reenviar sem duplicar. |
| `titulo` | sim | Aparece em destaque no card. Os títulos usados hoje: `Entrada Produto`, `Integração`, `Imagem`, `Atendimentos`, `Devoluções`, `Contabilidade`. Texto livre também funciona. |
| `skuTipo` | não | `SKU`, `MLB` ou `ID Anúncio`. Só rotula o código na frente do card. |
| `sku` | não | O código em si. Aparece no card como `MLB: MLB4038735524`. |
| `descricao` | não | Texto de apoio, visível ao abrir a tarefa. |
| `responsaveis` | sim | Lista de **chaves** de usuário (não os nomes): `cmandrade`, `matheusm`, `gustavo`, `carlosred`. |
| `responsavel` | sim | Repita a primeira chave da lista. É o campo antigo, ainda lido por telas mais velhas. |
| `vencimento` | sim | `AAAA-MM-DD`. **Leia a observação sobre a data mais abaixo.** |
| `prioridade` | sim | `normal`, `alta` ou `urgente`. |
| `status` | sim | `aberta` (A Fazer), `andamento` (Com Pendência), `concluida` ou `finalizada`. Para uma tarefa nova, `aberta`. |
| `criadoEm` | sim | `DD/MM/AAAA` — formato brasileiro, diferente do `vencimento`. |
| `criadoPor` | sim | Nome que aparece em "Solicitado por" no card. |
| `criadoPorKey` | sim | Chave de quem criou. Para integração use `n8n` — não precisa ser um usuário do sistema. |
| `ordemManual` | sim | Número usado para ordenar. `Date.now()` resolve. |

### Nunca mande `_by`

É o campo que o sistema usa para reconhecer o que veio de fora. Se o registro
chegar com `_by`, os navegadores podem ignorá-lo achando que é eco da própria
sessão.

---

## Atenção com o `vencimento`

O quadro trabalha em dias e **esconde tarefa com data futura** — ela só aparece
no dia do prazo. É de propósito: evita poluir o kanban com o que está agendado
para semana que vem.

Então, para a tarefa aparecer **hoje**, mande a data de hoje:

```js
"vencimento": new Date().toISOString().slice(0,10)
```

Se mandar amanhã, o card existe mas fica invisível até lá. E no dia seguinte ao
vencimento ele passa sozinho para a coluna **Atrasadas**.

---

## Exemplo de nó Code no n8n

```js
const agora = Date.now();
const hoje  = new Date();

return {
  json: {
    id           : 'ext_' + $json.numero_do_chamado,
    titulo       : 'Integração',
    skuTipo      : 'MLB',
    sku          : $json.mlb || '',
    descricao    : $json.observacao || '',
    responsaveis : ['gustavo'],
    responsavel  : 'gustavo',
    vencimento   : hoje.toISOString().slice(0, 10),
    prioridade   : 'normal',
    status       : 'aberta',
    criadoEm     : hoje.toLocaleDateString('pt-BR'),
    criadoPor    : 'Base (n8n)',
    criadoPorKey : 'n8n',
    ordemManual  : agora
  }
};
```

E no nó HTTP Request seguinte, o corpo vai como `{{ JSON.stringify($json) }}`.

---

## Uma "Entrada" pelo caminho externo

O que a tela grava numa Entrada, traduzido para o JSON:

```json
{
  "id": "ext_entrada_LE22306",
  "titulo": "Entrada Produto",
  "skuTipo": "SKU",
  "sku": "LE22306",
  "descricao": "Criar/Atualizar o produto em questão informado",
  "marketplace": "BASE",
  "responsaveis": ["gustavo"],
  "responsavel": "gustavo",
  "vencimento": "2026-08-12",
  "prioridade": "urgente",
  "status": "aberta",
  "criadoEm": "12/08/2026",
  "criadoPor": "Base (n8n)",
  "criadoPorKey": "n8n",
  "ordemManual": 1786550000000
}
```

Três detalhes que a tela aplica sozinha e o n8n precisa mandar explícito:

- **`prioridade`**: Entrada entra como `urgente`.
- **`marketplace`: `"BASE"`** — é a plataforma fixa da Entrada.
- **`descricao`**: o texto padrão *"Criar/Atualizar o produto em questão
  informado"*, que na tela vira o comentário fixo.

O prazo pela tela é de **2 dias úteis**. Se quiser o mesmo comportamento, calcule
no nó de Code — mas lembre que data futura fica invisível no quadro até o dia.
Para a tarefa aparecer na hora, mande a data de hoje.

---

## A fila antiga (`suplelive/atividadesExternas`)

Continua funcionando, mas é o caminho antigo e tem duas limitações: só importa
com **um master logado** e não grava `sku`, `skuTipo`, `marketplace` nem
`responsaveis` (só um responsável). Para integrações novas, use a gravação
direta descrita acima.

---

## O que o sistema faz sozinho depois

- O card aparece em **Tarefas Diárias** sem ninguém atualizar a página.
- Concluir, marcar pendência e finalizar seguem as regras normais de permissão.
- O print da conclusão é anexado pela tela, não pela API — a imagem original vai
  para `suplelive/imagens` e só a miniatura fica no registro.

- **Os responsáveis são notificados automaticamente.** O sistema reconhece que
  a tarefa nasceu fora (o `criadoPorKey` não é um usuário cadastrado) e dispara
  o aviso no sino assim que o registro chega, com o nome que estiver em
  `criadoPor`. A marca `notificadaEm` fica gravada no registro, então dois
  navegadores abertos não avisam duas vezes.

  Só é preciso **um navegador aberto** para o aviso sair — não precisa ser o do
  master. Tarefas que já chegam com `status` diferente de `aberta` não geram
  notificação.

---

## Testando

1. Rode o fluxo uma vez com um `id` de teste, tipo `ext_teste_1`.
2. Firebase Console → Realtime Database → confira
   `suplelive/reg/atividades/ext_teste_1`.
3. Abra o LiveOps: o card deve estar em Tarefas Diárias, coluna **A Fazer**.
4. Rode de novo com o mesmo `id`: tem que continuar **um** card.
5. Para limpar o teste, exclua a tarefa pela tela (o master tem a lixeira no card).

| Sintoma | Onde olhar |
|---|---|
| `401` / `403` | Escopos da credencial, ou a chave privada colada pela metade |
| `400 invalid key` | O `id` tem `.` `#` `$` `/` `[` `]` |
| Gravou, mas o card não aparece | `vencimento` está no futuro, ou `status` não é um dos quatro valores |
| Card sem responsável | `responsaveis` veio com o nome (`"Gustavo"`) em vez da chave (`"gustavo"`) |
| Card duplicado | O `id` muda a cada execução — não use `Date.now()` nele |
