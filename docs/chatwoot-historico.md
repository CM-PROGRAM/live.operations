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

## Varrer uma caixa por vez, e alimentar a agenda

Toda a configuração fica num nó só: **Resolver caixa**.

```js
const CAIXA = '2. Antigo';   // '' = todas. Aceita pedaço do nome ('antigo')
const CRIADO_ANTES = '';     // 'AAAA-MM-DD' = o "Criado em / é menos que" da tela
const TRAZER_MENSAGENS = false;
const PAGINA_INICIAL = 1;
const PAGINAS_MAX = 0;       // 0 = tudo
```

Se o nome da caixa não existir, o fluxo para e diz quais existem — em vez
de varrer a caixa errada em silêncio.

Cada conversa varrida alimenta **duas** coisas: a caixa do WhatsLive e a
**agenda de contatos** (`Nome`, `Sobrenome`, `Telefone`, `CPF`).

O id do contato sai do telefone — `wct_5527999987802` — e não do relógio.
Consequências, todas boas:

- rodar a varredura duas vezes **reescreve** o mesmo registro, não duplica;
- o mesmo cliente visto na `2. Antigo` e na `1. Oficial` vira **um** contato;
- quem já estava salvo à mão não vira gêmeo: a agenda junta pelos 8 últimos
  dígitos e mostra o registro mais completo (quem tem CPF ganha).

O **CPF** vem de `custom_attributes.cpf` no Chatwoot — o mesmo campo que o
LiveOps preenche ao cadastrar um contato. Quem não tiver o atributo
preenchido lá entra na agenda sem CPF, para você completar depois.

## As duas caixas não são iguais

| | `1. Oficial` | `2. Antigo` |
|---|---|---|
| canal | API oficial (Gupshup) | **Evolution** |
| webhook da caixa | `webhookn8n…/chatwoot-saida` | `evolution.suplelive.com.br/chatwoot/webhook/SL1` |
| serve para | atender hoje | ler o histórico |

Duas consequências práticas:

- **Enviar** para uma conversa da `2. Antigo` sai pelo Evolution, não pelo
  Gupshup. Se aquela instância não estiver mais conectada ao WhatsApp
  antigo, a mensagem some sem erro visível. Trate a caixa Antigo como
  leitura, não como canal de atendimento.
- Contato criado pelo Evolution às vezes vem **sem `phone_number`**, com o
  número escondido no `identifier` (`5527…@s.whatsapp.net`). A conversão
  cai nesse campo quando o telefone vem vazio — sem essa rede, boa parte da
  agenda do número antigo entraria sem telefone, que é a chave de tudo.

O `chatwoot-inbox` que alimenta o WhatsLive ao vivo **não** é o webhook da
caixa: ele está registrado no nível da conta (Configurações → Integrações →
Webhooks). Por isso a `2. Antigo` apontar para o Evolution não atrapalha a
leitura — mas também significa que mensagem nova chegando no número antigo
só entra no LiveOps se aquele webhook de conta estiver ligado.

## A ordem sugerida

1. `CAIXA = '2. Antigo'`, como vem — traz as conversas antigas e joga todos
   aqueles contatos na agenda.
2. `CAIXA = '1. Oficial'` — a trajetória de quem está ativo hoje.
3. Só então `TRAZER_MENSAGENS = true`, com `PAGINAS_MAX = 20`, caixa por
   caixa, avançando o `PAGINA_INICIAL` de 20 em 20.

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

(no nó **Resolver caixa**, não no `Paginas a varrer` — esse agora só faz a conta)

Rode, avance o `PAGINA_INICIAL` de 20 em 20, e repita até o Placar avisar
que passou da última página. Para 132 páginas são 7 rodadas.

## A caixa Oficial: histórico + tempo real

O histórico da `1. Oficial` sai do mesmo fluxo, trocando o `CAIXA`. Mas ela
não pode parar aí — precisa continuar entrando sozinha.

Quem faz isso é o fluxo ao vivo `n8n-inbox-chatwoot`, que já recebia cada
mensagem nova e agora também alimenta a agenda: o ramo
**`Contato para a agenda` → `Gravar contato na agenda`**.

O id do contato é o mesmo dos dois lados — `wct_<dígitos do telefone>` — então
quem já veio do histórico **não vira um segundo registro**: é o mesmo, atualizado.

A gravação ao vivo é um `PATCH` no registro, e de propósito **não** manda
`cpf`, `criadoEm` nem `criadoPor`. Campo que não viaja fica como estava —
se mandasse `cpf: ''`, cada mensagem nova apagaria o CPF que alguém digitou
na tela. Ela manda `visto`, o carimbo da última interação.

Resultado: o histórico é uma varredura de uma vez; daí em diante, contato
novo que fala com a gente entra sozinho.

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
