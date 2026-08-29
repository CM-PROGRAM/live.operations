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

## O que vem depois (a virada de leitura)

Com a sala no ar, o passo seguinte — feito em código, com teste
acompanhado — é o sistema **abrir pela Cloudflare**: estado do
`/dados/pacote/state`, coleções do `/dados/colecao`, atualizações pela
sala, presença pela sala. O Firebase continua recebendo cópia de tudo
(gravação dupla) e fica de reserva até a decisão final de desligar —
que é a etapa 5 (login próprio), a última.

## Custos

- Durable Objects existem no plano grátis dos Workers (com franquia);
  para o uso do LiveOps (poucas pessoas conectadas), o custo esperado é
  **zero**. Se um dia apertar, o plano de US$ 5/mês resolve com folga.
