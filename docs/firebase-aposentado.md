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

## Como voltar atrás

`FB_APOSENTADO = false` e republicar. O código do caminho antigo continua
inteiro — não foi apagado, só deixou de ser o padrão. No worker, apagar a
variável `FB_REPASSE` devolve a cópia.

Por navegador, `cfLeitura('off')` + F5 continua valendo como saída de
emergência para a leitura.

## O que confirmar depois de publicar

- O rodapé mostra **2026.08.31p** e o sistema abre com os dados de hoje
  (não com a foto do último acesso — se abrir vazio, a leitura pela
  Cloudflare falhou e o console diz por quê)
- Uma alteração em Vendas aparece na tela do outro em segundos
- O console **não** mostra mais `[Firebase]` em gravação nenhuma
- No worker, `/saude` responde `ok v17`
