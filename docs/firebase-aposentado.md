# O desligamento do Firebase — 31/08/2026

Um interruptor, um lugar: `FB_APOSENTADO = true` no `index.html`
(**2026.08.31p**), mais `FB_REPASSE = off` no worker (**v17**).

Ligado, o sistema para de pensar em dois bancos.

## O que mudou

| | antes | agora |
|---|---|---|
| Leitura | Cloudflare (`preferir`, desde 30/08) | Cloudflare |
| Gravação | Cloudflare + cópia no Firebase | **só Cloudflare** |
| Quem entra | Firebase decide, cofre é reserva | **cofre decide** |
| Banco antigo | aberto e escutando | **nem é aberto** (`db` fica nulo) |

Com `db = null`, os cerca de trinta `if(db && fbConnected)` espalhados
pelo sistema viram no-ops de uma vez só. É o desligamento mais seguro
possível aqui: nenhuma gravação some por engano, porque desde a **31j**
todas elas já sobem pela Cloudflare por conta própria.

## A única ponte que sobra — e ela se apaga sozinha

Quem **nunca semeou senha** no cofre entra pelo Firebase uma última vez e
é semeado na hora. No login seguinte, essa exceção já não existe para
essa pessoa.

```
cofre diz "sem-cadastro" → Firebase confirma → semeia → entra
```

Sem essa ponte, quem estivesse na lista de pendentes do painel de
Segurança ficaria trancado do lado de fora no dia do desligamento.

**Melhor ainda:** o master não precisa esperar ninguém logar. A rota nova
`/auth/definir` deixa ele **definir a senha de qualquer pessoa direto no
cofre**, sem Firebase nenhum. É o que o botão *Redefinir senha* do painel
faz agora.

Isso fecha dois buracos de uma vez:
- quem nunca semeou passa a ter senha sem depender do Firebase;
- a troca de senha pelo master deixa de ser um beco sem saída — antes ela
  valia só na cópia do estado, e o cofre seguia com a senha antiga.

## Ordem de implantação

O `index.html` **2026.08.31p** não entra nesta lista: ele foi para o `main`
e o GitHub Pages já publicou sozinho. O que precisa de mão é só o que vive
fora do GitHub.

1. **Publicar o worker v17** (traz `/auth/definir` e o `FB_REPASSE`) — painel
   da Cloudflare, *Edit code* → *Deploy*
2. No painel do worker, criar a variável **`FB_REPASSE` = `off`** — é ela
   que corta a cópia para o banco antigo
3. **Administrador → Segurança** → para cada pessoa ainda sem senha no
   cofre (o painel lista), clicar **Redefinir senha**, definir uma e
   avisar a pessoa
4. Conferir em `/auth/semeados` que todo mundo aparece
5. Só então, no console do Firebase: desativar o Realtime Database

## Quando a última linha do Firebase pode cair

Quando `/auth/semeados` listar **todos** os usuários, a ponte de login
não serve mais para ninguém. Aí dá para:

- apagar a `FB_CONFIG` do `index.html` (nada mais no sistema a procura);
- remover os secrets `FB_SA_EMAIL` e `FB_SA_KEY` do worker;
- apagar o projeto no Firebase.

Enquanto isso não acontece, o custo do Firebase é zero: ninguém lê, ninguém
grava, e o Auth só é consultado no primeiro login de quem falta.

## A queda de sala que ficou sem rede de proteção (**2026.08.31q**)

Quatro tentativas de reconectar a sala sem sucesso e o sistema chamava
`_cfVoltarParaFirebase` — desligava `_cfLeituraAtiva` e passava a ouvir o
banco antigo. Com o Firebase aposentado, `db` é nulo: não havia para onde
voltar. A sessão ficava muda (inbox, avisos e notificações são todos
guardados por `_cfLeituraAtiva`) e o painel de Segurança ainda anunciava
*"lendo pelo Firebase agora"*.

Agora, sem banco antigo:

- a leitura **não** é desligada — o que caiu foi o fio do tempo real, e a
  leitura por HTTP segue de pé;
- a reconexão continua tentando, com aviso uma única vez;
- quando a sala volta, `_cfRessincronizar()` relê pacote e listas: o que os
  outros gravaram durante a queda não é guardado para depois, então voltar
  a ouvir não bastava;
- o painel passa a dizer a verdade, em vermelho, se a leitura realmente
  parar.

## O projeto foi excluído — **2026.08.31r** e worker **v18**

Desativar não bastava: projeto que existe pode ser reaberto, copiado ou
violado um dia. A pedido do master, o projeto do Firebase foi **excluído**
em 31/08/2026, e o código foi limpo para não sobrar nada apontando para um
fantasma.

**No `index.html` (31r)**

| Saiu | Por quê |
|---|---|
| A `firebaseConfig` inteira | Endereço de projeto morto num repositório público é pista para quem sonda |
| O download do SDK (3 arquivos do gstatic) | Três downloads e um atraso na abertura para falar com o que não existe |
| A ponte de primeiro login | Todo mundo já tem senha no cofre; quem faltar, o master resolve em dois cliques |
| A redefinição por e-mail | O e-mail era do Firebase. Agora a tela manda pedir ao master, em vez de fingir que enviou |
| As ferramentas do banco antigo no painel | Escondidas, não apagadas — a faxina final é outro dia |

E uma distinção que **precisava** nascer aqui: worker mudo deixou de virar
`sem-cadastro`. Antes o Firebase decidia em seguida, então dava no mesmo;
sem ele, confundir *"não respondeu"* com *"não tem senha"* mandaria a
pessoa pedir senha nova ao master quando o problema era a internet dela.

**No worker (v18)**

- `repassarAoFirebase` virou uma linha só. A conta de serviço
  (`tokenGoogle`, `FB_SA_EMAIL`, `FB_SA_KEY`) saiu inteira.
- **O crachá do Firebase deixou de ser aceito.** Era uma dependência
  externa viva — buscar chaves públicas do Google num portão de
  autenticação — para validar tokens de um projeto que não existe. Fica um
  crachá só: o que este worker emite.
- Saíram `PROJETO`, `JWKS_URL`, `FB_BASE` e o cache de JWKS.

**No painel da Cloudflare, dá para apagar:** `FB_SA_EMAIL`, `FB_SA_KEY` e
`FB_REPASSE`. Não há mais o que ligar, desligar ou autenticar.

## Não há mais como voltar atrás — e está certo assim

Até a 31p, `FB_APOSENTADO = false` devolvia tudo. Com o projeto excluído,
o caminho de volta deixou de ser um interruptor: seria **criar um projeto
novo**, semear as contas de novo e reapontar a configuração. Foi uma
decisão consciente do master, tomada depois de o painel de Segurança
mostrar as três linhas verdes.

O que continua sendo saída de emergência é o que importa: `cfLeitura('off')`
+ F5, por navegador, e o worker respondendo em `/saude`.

## O que confirmar depois de publicar

- O rodapé mostra **2026.08.31r** e o sistema abre com os dados de hoje
  (não com a foto do último acesso — se abrir vazio, a leitura pela
  Cloudflare falhou e o console diz por quê)
- Uma alteração em Vendas aparece na tela do outro em segundos
- O console **não** mostra mais `[Firebase]` em gravação nenhuma
- No worker, `/saude` responde `ok v18`
- Na aba Rede do navegador (F12), a abertura **não** busca nada em
  `gstatic.com/firebasejs` — se buscar, o `index.html` publicado é antigo
- Todo mundo consegue entrar. É o teste que importa: sem o Firebase, quem
  entra é quem tem senha no cofre, e mais ninguém
