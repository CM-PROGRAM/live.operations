# Migração para a Cloudflare — Etapa 4: tempo real e leitura

## O que esta etapa constrói

É a etapa que transforma a Cloudflare de cofre em coração — a peça que
um dia substitui o tempo real do Firebase:

- **A sala** (`Sala`, um Durable Object): cada navegador logado abre um
  WebSocket para ela; toda gravação que passa pelo worker é anunciada na
  hora a todos os conectados; a lista de quem está online sai do próprio
  conjunto de conexões (o futuro substituto do `presence`).
- **Rotas de leitura** do espelho: `/dados/registro` (um registro) e
  `/dados/colecao` (página de registros), para o sistema poder LER da
  Cloudflare em vez do Firebase.

**Nada muda para quem usa ainda.** O sistema continua lendo e
sincronizando pelo Firebase; esta etapa sobe a infraestrutura do lado da
Cloudflare para a virada de leitura ser feita depois, com calma e teste
conjunto. Sem o binding `SALA`, a rota `/rt` responde erro e todo o
resto segue normal.

---

## Passo a passo no painel (2 cliques, como sempre)

### 1. Colar o worker atualizado

- Worker `liveops-imagens` → **Edit code** → apagar tudo → colar o
  conteúdo novo de `cloudflare/worker-imagens/worker.js` → **Deploy**.
- Conferir: `/saude` respondendo **ok**.

### 2. Amarrar a sala

- Worker → **Settings** → **Bindings** → **Add** → **Durable Object**.
- **Variable name**: `SALA` (maiúsculas)
- **Durable Object class**: `Sala` — do próprio worker `liveops-imagens`
  (a classe aparece na lista depois que o passo 1 for publicado).
- Salvar (e **Deploy**, se pedir).

> Se o painel reclamar de "migration" ao amarrar a classe, é só aceitar
> o que ele sugerir — é o registro de que a classe `Sala` é nova.

### 3. Conferir

No console do sistema (F12), com o espelho ligado:

```js
_cfToken().then(tk=>{const ws=new WebSocket(CF_IMG_URL.replace('https','wss')+'/rt?token='+tk);ws.onmessage=e=>console.log('[sala]',e.data);ws.onopen=()=>console.log('[sala] conectado!');})
```

Deve aparecer `[sala] conectado!` e, em seguida, uma mensagem de
`presenca`. Gravando qualquer coisa no sistema em outra aba, chega um
`mudanca` — é o tempo real da Cloudflare funcionando de ponta a ponta.

---

---

# Parte 2 — o sistema lendo pela Cloudflare

**Desde 30/08/2026 o padrão é `preferir` para toda a equipe.** Até essa
data ele veio `off` por publicação e foi ligado só no navegador do
master, que rodou em `conferir` e depois em `preferir` por dias — a
virada é a conclusão desse teste, não o começo dele.

Continua reversível **por navegador**, sem esperar publicação: quem
precisar volta com `cfLeitura('off')` e um F5.

## Os três modos

| Modo | O que faz |
|---|---|
| `off` | O sistema de sempre — lendo do Firebase |
| `conferir` | O Firebase continua mandando. A Cloudflare é lida em paralelo e **comparada** com o que está na tela, só relatando no console; a sala fica conectada o dia inteiro para provar que aguenta |
| `preferir` | **A virada**: o sistema abre pela Cloudflare e recebe as mudanças pela sala; os listeners do Firebase nem são ligados — é aí que o download deixa de ser gasto |

Em `preferir`, o Firebase **continua recebendo cópia de tudo** (a
gravação segue dupla) e volta a ser ouvido sozinho se a Cloudflare
falhar: se o boot não conseguir ler, ou se a sala cair e não reconectar
em quatro tentativas, a sessão religa os listeners do Firebase e avisa
na tela. Ninguém trabalha às cegas.

## Como testar (no console do sistema, F12)

**Passo 1 — conferência (um dia inteiro, sem risco):**

```js
cfLeitura('conferir')
```

Recarregue a página (F5). A partir daí, a cada abertura:

- a sala conecta e fica conectada (`[cf][sala] conectada`);
- 20 segundos depois sai no console uma tabela comparando, lista por
  lista, o que está na tela com o que está no espelho — e o veredito
  `✓ o espelho bate com a tela` ou o aviso do que divergiu;
- cada gravação feita por qualquer pessoa aparece como
  `[cf][sala] mudança recebida:` — a prova de que o tempo real chega.

A qualquer momento dá para repetir a comparação com `conferirNuvens()`
e ver quem a sala enxerga com `cfQuemEstaNaSala()`.

**Passo 2 — a virada, só depois da conferência limpa:**

```js
cfLeitura('preferir')
```

Recarregue. O sistema abre com `☁ Sistema aberto pela Cloudflare — N
registros`. Confira: as telas devem estar iguais, e uma alteração feita
em outro navegador precisa aparecer aqui sozinha, como sempre apareceu.

**Para voltar ao normal, a qualquer instante:**

```js
cfLeitura('off')
```

Recarregue — e a sessão volta a ser exatamente a de antes.

## Por que isso é o degrau que importa

É aqui que o download sai do Firebase: em `preferir`, o sistema não
baixa mais o pacote nem as listas de lá na abertura — que é justamente
o que estourou a cota de agosto (14,6 GB de 10 GB). Com a equipe toda
em `preferir`, o consumo do Firebase cai para quase nada mesmo antes de
ele ser desligado.

## O que vem depois

| Etapa | O quê | Situação |
|---|---|---|
| 4 · parte 1 | Sala + rotas de leitura no worker | ✅ publicada |
| 4 · parte 2 | Sistema lendo pela Cloudflare (este documento) | ✅ no código, desligada por padrão |
| 4 · parte 3 | Ligar `preferir` para todo mundo, por publicação | ✅ 30/08/2026 |
| 3 | Robôs do n8n gravando na Cloudflare | ✅ em produção |
| 5 | Login próprio (`cloudflare-login.md`) | ✅ no código |
| 6 | **Desligar o Firebase** | os 7 passos em `cloudflare-login.md` |

## Custos

- Durable Objects existem no plano grátis dos Workers (com franquia);
  para o uso do LiveOps (poucas pessoas conectadas), o custo esperado é
  **zero**. Se um dia apertar, o plano de US$ 5/mês resolve com folga.
