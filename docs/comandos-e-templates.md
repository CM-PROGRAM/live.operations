# Comandos e templates no WhatsLive

Duas coisas diferentes moram atrás da mesma tecla `/` na conversa. Vale
saber qual é qual, porque o caminho para criar cada uma é outro.

## 1. Comando do canal — dispara na hora

`/iniciar_atendimento`, `/pix`. São palavras que o **próprio canal do
WhatsApp** entende. Hoje se digita à mão dentro do Chatwoot; no WhatsLive
elas aparecem no `/` com a barra amarela e o rótulo **⚡ disparar**.

- **Onde se cria:** aba **Templates → Comandos do canal → + Novo comando**
  (só o master). Ali também se edita o nome, a descrição e o que sai.
- **Não passa pela Meta.** Não tem aprovação, não tem categoria.
- **Sai cru.** O canal só reconhece o comando quando ele é a mensagem
  inteira, então este é o único envio que **não** leva a assinatura
  `*Manoel - Suplelive:*`. Quem cuida disso é o nó `Montar envio` do fluxo
  `n8n-inbox-chatwoot`, olhando o campo `cru:true` que o LiveOps manda.
- **Fica registrado como nota interna** na conversa
  (`⚡ /pix — disparado no canal`), com o nome de quem apertou. O cliente
  não vê essa nota; a equipe vê.

## 2. Template — escreve no campo

`/boasvindas`, `/segunda`, `/recompra` e os oficiais aprovados pela Meta.
Clicar **não envia**: o texto cai no campo de digitação, com o
`{{client_name}}` já trocado pelo primeiro nome do contato, para ser
revisado antes de ir.

- **Onde se cria (livre):** aba **Templates → + Novo**. Vale para mensagem
  de rotina dentro da janela de 24h.
- **Onde se cria (oficial da Meta):** o template em si nasce no
  **gupshup.io** e é lá que se pede aprovação. Quando a Meta aprova, ele
  aparece no **Espelho do Gupshup** (fim da aba Templates) com o selo
  `APROVADO` e um botão azul **+ Cadastrar comando /nome**. É esse clique
  que cria o comando aqui dentro.
- **Aprovou vários de uma vez?** O placar acima da lista diz quantos
  aprovados existem e quantos já viraram comando; o botão
  **+ Cadastrar os N que faltam** resolve todos num clique.

## Respondendo direto: "cadê os comandos?"

O comando de um template aprovado **não nasce sozinho**. Ele nasce no
clique do botão azul do Espelho do Gupshup — antes disso o template existe
na Meta mas não tem atalho no LiveOps. O placar do espelho é justamente o
lugar de conferir isso: `N aprovados pela Meta · M já com comando no
LiveOps`.

## O que ainda falta (envio de template oficial fora da janela)

Hoje o `/template` cadastrado copia o **texto** e manda como mensagem
comum. Isso funciona dentro da janela de 24h do WhatsApp. Fora dela, a
Meta exige o disparo pela API de template do Gupshup, com o `id` do
template e os parâmetros separados — não basta o texto.

O `id` já passou a ser guardado: o nó `Formatar templates` do fluxo
`n8n-gupshup-templates` devolve `id`, e o LiveOps grava em `gupId` ao
cadastrar o comando. Falta o fluxo de disparo que consome esse `gupId`.
Sem ele, um template mandado fora da janela simplesmente não chega.
