# Comandos, macros e templates no WhatsLive

Quatro coisas diferentes moram atrás da mesma tecla `/`. Confundi-las custou
caro uma vez: a versão 2026.08.31c mandou a palavra `/pix` escrita para o
WhatsApp de um cliente, achando que o canal a entenderia. Não entende.

## 1. Macro do Chatwoot — roda na hora

O **PIX** e o **Adiado** que aparecem na barra lateral direita do Chatwoot.
Uma macro é uma sequência de ações que o Chatwoot executa: mandar uma
mensagem, colocar etiqueta, atribuir agente, resolver a conversa.

- **Não é texto.** Mandar `/pix` escrito na conversa entrega literalmente a
  palavra `/pix` ao cliente. A macro só roda pela API.
- **Onde se cria:** Chatwoot → **Configurações → Macros**. Não se cria no
  LiveOps; o LiveOps espelha.
- **Como o LiveOps dispara:** `POST /api/v1/accounts/1/macros/{id}/execute`
  com `{"conversation_ids":[id_interno]}`. Fluxo `chatwoot-macro-exec`.
- **Pegadinha do id:** a URL da conversa mostra o `display_id` (3383), mas
  executar macro pede o **id interno**. O fluxo faz um `GET` na conversa
  antes, só para trocar um pelo outro. Sem isso a macro rodaria na conversa
  de outra pessoa.
- No WhatsLive aparece no `/` com barra amarela e **⚡ executar**, e deixa
  uma nota interna com o nome de quem apertou.

## 2. Resposta pronta do Chatwoot — escreve no campo

O que o `/` do próprio Chatwoot oferece ("Digite '/' para selecionar uma
Resposta Pronta"). É **só texto** — não executa nada sozinha.

- **Onde se cria:** Chatwoot → **Configurações → Respostas Prontas**.
- No WhatsLive aparece no `/` pelo atalho (`/rastreio`) e cai no campo de
  digitação para você revisar antes de mandar.

## 3. Template do LiveOps — escreve no campo

`/boasvindas`, `/segunda`, `/recompra`. Texto nosso, com variáveis
(`{{client_name}}`, `{{order_id}}`), usado dentro da janela de 24h.

- **Onde se cria:** aba **Templates → + Novo**.

## 4. Template oficial da Meta — aprovado no Gupshup

- **Onde nasce:** **gupshup.io**, e é lá que se pede aprovação à Meta.
- **Onde vira comando:** aprovado, ele aparece no **Espelho do Gupshup**
  (fim da aba Templates) com o selo `APROVADO` e o botão azul
  **+ Cadastrar comando /nome**. É esse clique que cria o atalho aqui —
  antes disso o template existe na Meta mas não tem comando no LiveOps.
- **Aprovou vários?** O placar do espelho diz quantos aprovados existem e
  quantos já viraram comando, e o botão **+ Cadastrar os N que faltam**
  resolve todos de uma vez.

## O que ainda não existe

**Disparo de template oficial fora da janela de 24h.** Hoje o `/template`
cadastrado copia o **texto** e manda como mensagem comum — o que só passa
dentro da janela. Fora dela a Meta exige a API de template do Gupshup, com
o `id` do template e os parâmetros separados.

O `id` já é guardado: o nó `Formatar templates` do fluxo
`n8n-gupshup-templates` devolve `id`, e o LiveOps grava em `gupId` ao
cadastrar o comando. Falta o fluxo de disparo que consome esse `gupId`.

## Fluxos envolvidos

| fluxo | webhook | o que faz |
|---|---|---|
| `n8n-chatwoot-macros` | `chatwoot-macros` | lê macros e respostas prontas do Chatwoot |
| `n8n-chatwoot-macros` | `chatwoot-macro-exec` | executa uma macro numa conversa |
| `n8n-gupshup-templates` | `gupshup-templates` | espelha os templates oficiais e o saldo |
| `n8n-inbox-chatwoot` | `chatwoot-envia` | manda mensagem de texto |

O `chatwoot-envia` aceita `cru:true` para mandar sem a assinatura
`*Manoel - Suplelive:*`. Isso **não** serve para macro — serve para o nó
`Iniciar atendimento (comando)`, que já mandava assim.
