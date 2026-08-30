# Trazer o histórico do Chatwoot para o WhatsLive

Fluxo `docs/n8n-chatwoot-historico.json` — "Chatwoot → LiveOps · Histórico
completo (rodar na mão)". Gatilho manual: roda quando você mandar.

## O erro que essa versão conserta

A primeira versão varria **20 páginas fixas**. O Chatwoot devolve 25
conversas por página, **da mais recente para a mais antiga** — então 20
páginas = as 500 conversas mais recentes, ou seja os últimos dez dias.
Janeiro nunca chegou perto de ser lido.

Agora o fluxo pergunta ao Chatwoot quantas conversas existem
(`meta.all_count`) e monta sozinho todas as páginas até cobrir esse número.
Para 3.286 conversas, são 132 páginas.

## Como rodar

### 1ª passada — as conversas (rápida)

Abra o fluxo e clique em **Execute workflow**. Como está, ele traz **só a
lista de conversas**: ~132 chamadas, cerca de um minuto. Ao terminar, o
WhatsLive mostra todo mundo desde janeiro, cada um com a última fala.

O nó **Placar** diz o resultado:

```
Varredura completa: 3286 conversa(s) de 3286. Não precisa rodar de novo.
```

Se disser "Faltou gente", rode de novo — alguma página falhou.

### 2ª passada — as mensagens (em blocos)

Aqui é **uma chamada por conversa**. Três mil de uma vez estoura o tempo
da execução, então vai em blocos. No nó **Paginas a varrer**:

```js
const TRAZER_MENSAGENS = true;
const PAGINA_INICIAL = 1;     // depois 21, 41, 61...
const PAGINAS_MAX = 20;       // 20 páginas = 500 conversas por rodada
```

Rode, avance o `PAGINA_INICIAL` de 20 em 20, e repita até o Placar avisar
que passou da última página. Para 132 páginas são 7 rodadas.

## O que esse fluxo NÃO traz

**Todas as mensagens de cada conversa.** O endpoint de mensagens do
Chatwoot devolve as **~20 mais recentes** de cada conversa. Para uma
conversa longa, o começo dela fica de fora.

Trazer o resto exigiria percorrer cada conversa de trás para frente com o
parâmetro `before=<id da mensagem>` — outro fluxo, e pesado. Se algum
atendimento específico precisar do histórico inteiro, dá para fazer uma
varredura só dele.

## Detalhes que importam

- **Não filtra por caixa de propósito.** O número novo (`1. Oficial`) e o
  antigo (`2. Antigo`) entram na mesma varredura — era isso que se queria
  ao pedir "todo o histórico".
- **Ritmo controlado:** 5 chamadas por segundo (`batching`), para não
  derrubar o Chatwoot no meio da varredura.
- **Uma conversa problemática não mata a rodada:** o nó de mensagens está
  em `continueRegularOutput`, e o item continua saindo para não desalinhar
  o pareamento por índice.
- **Regravar é seguro.** As conversas sobem em blocos de 200 num `PATCH`
  por chave (`cw_123`), e as mensagens idem (`m456`). Rodar duas vezes
  sobrescreve o mesmo registro em vez de duplicar.
- **Teto de segurança:** 600 páginas (15.000 conversas). Passando disso, o
  número está no próprio código.
