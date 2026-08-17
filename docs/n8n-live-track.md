# Live Track — rastreamento automático via n8n

Como o n8n atualiza sozinho, de hora em hora, o status dos envios que estão
na sub-aba **Live Track** do LiveOps.

O caminho é o mesmo que o n8n já usa para criar tarefas (ver
`n8n-tarefas.md`): grava-se **um registro** no Realtime Database e o card se
atualiza na hora, em todos os navegadores abertos, sem ninguém recarregar
nada.

---

## 1. Arquitetura: por que API do intermediador, e não scraping

A tentação é automatizar os quatro sites que a equipe abre hoje. Não faça
isso, por três motivos concretos:

| Site | Por que não automatizar |
|---|---|
| jadlog.com.br/jadlog/**captcha** | O captcha está no nome da URL. Ele existe exatamente para impedir robô. |
| melhorrastreio.com.br | Agregador de terceiros, sem contrato com você. Muda de layout sem aviso e bloqueia por IP. |
| siterastreio.com.br | Mesma coisa. E fica entre você e os Correios: dois pontos de falha em vez de um. |
| app.loggi.com/rastreador | Área logada, protegida contra automação. |

Scraping desses portais dá um workflow que funciona na sexta e quebra no
sábado — e quebra em silêncio, o que é pior: a equipe passa a confiar num
status que parou de atualizar há três dias.

**A regra da arquitetura: perguntar a quem gerou a etiqueta.**

O envio nasceu no Melhor Envio ou no Manda Bem. São eles que têm o contrato
com a transportadora e já recebem os eventos de rastreio. Isso resolve numa
credencial só o que seriam seis integrações separadas:

```
                    ┌─────────────────────┐
    J&T ────────────┤                     │
    Loggi ──────────┤   Melhor Envio API  ├──── 1 token OAuth2
    Jadlog ─────────┤                     │
    Correios ───────┤   (rastreio já      │
    Azul Cargo ─────┤    agregado)        │
                    └─────────────────────┘
                    ┌─────────────────────┐
    Loggi ──────────┤                     │
    Jadlog ─────────┤   Manda Bem API     ├──── 1 credencial
    Correios ───────┤                     │
                    └─────────────────────┘
```

### Ordem de preferência das fontes

1. **API do intermediador** (Melhor Envio / Manda Bem) — sempre a primeira
   tentativa. É o dono do contrato e o único que sabe ligar o *código de
   rastreio* ao *seu pedido*.
2. **API oficial da transportadora** — só se o intermediador não devolver
   eventos. Exige contrato próprio com cada uma (Correios exige cartão de
   postagem; Jadlog, Loggi, J&T e Azul liberam token para cliente com
   contrato). Vale a pena para uma ou duas onde o volume é alto, não para as
   seis.
3. **Agregador pago com API** (17TRACK, Muambator, Rastreio.net e afins) —
   rede de segurança para o que sobrar. É scraping também, mas feito por
   quem assume o contrato de manter aquilo de pé. Custa dinheiro e resolve
   o caso "transportadora sem API".

### O que confirmar antes de construir

- **Melhor Envio**: API oficial documentada, OAuth2. Ponto de atenção — o
  rastreio é consultado pelo **id do pedido no Melhor Envio**, não pelo
  código da transportadora. Ou seja: o card precisa guardar esse id no
  momento em que a etiqueta é gerada, senão não há como consultar depois.
- **Manda Bem**: confirme com o suporte deles se o plano contratado expõe
  endpoint de rastreio e peça a documentação. Se não expuser, o caminho
  para os envios do Manda Bem é o item 2 ou 3 acima.

> Não invente endpoint. Peça a documentação aos dois e ajuste as URLs deste
> documento — o desenho do workflow não muda, só a URL de cada ramo.

---

## 2. O workflow no n8n

```
[Schedule Trigger 1h]
        │
[HTTP GET rastreios do LiveOps]
        │
[Code: fila de consulta]  ── descarta entregues, sem código, e quem ainda
        │                     está de castigo pelo backoff
[Split In Batches (10)]
        │
[Switch por intermediador]
        ├── Melhor Envio ──→ [HTTP Request]
        ├── Manda Bem ─────→ [HTTP Request]
        └── Sem fonte ─────→ [NoOp: marca pendência]
        │
[Code: padroniza a resposta]   ← o script da seção 4
        │
[IF: mudou alguma coisa?]
        ├── não → [NoOp]  (não reescreve o registro à toa)
        └── sim → [HTTP PATCH no LiveOps]
        │
[Wait 2s]  → volta para o Split In Batches
```

### 2.1 Schedule Trigger

- **Trigger Interval**: `Hours`, **Hours Between Triggers**: `1`
- Em *Workflow Settings*, **Timezone**: `America/Sao_Paulo`

Se preferir cravar o minuto, use Cron `7 * * * *` em vez de `0 * * * *`:
rodar aos 7 minutos evita o horário cheio, quando toda automação do mundo
bate nas mesmas APIs.

### 2.2 Ler os cards do Live Track

- **Method**: `GET`
- **URL**:
  ```
  https://suplelive-8a700-default-rtdb.firebaseio.com/suplelive/reg/rastreios.json
  ```
- **Authentication**: `Google Service Account API`, escopos
  `firebase.database` e `userinfo.email` — a mesma credencial de
  `n8n-tarefas.md`. Conta de serviço não passa pelas regras de segurança.

A resposta é um objeto `{ "rst_1786...": {...}, "rst_1787...": {...} }`.

### 2.3 Code — a fila de consulta

```javascript
// Entrada: o objeto inteiro de rastreios. Saída: só o que vale consultar agora.
const todos = $input.first().json || {};
const agora = Date.now();
const DIAS_ATE_DESISTIR = 45;

const fila = Object.entries(todos).map(([chave, r]) => ({ chave, ...r })).filter(r => {
  if (!r || !r.codigo) return false;                    // sem código não há o que consultar
  if (r.status === 'Entregue') return false;            // trabalho encerrado
  if (r.trackProximaConsulta && agora < r.trackProximaConsulta) return false; // backoff

  // Pacote parado há mais de 45 dias não volta a andar porque perguntamos de
  // novo. Sai da fila e vira problema humano, não de robô.
  const nasceu = Number(r.ordemManual || 0);
  if (nasceu && (agora - nasceu) > DIAS_ATE_DESISTIR * 864e5) return false;

  return true;
});

return fila.map(json => ({ json }));
```

### 2.4 Switch por intermediador

**Mode**: `Rules`, campo `{{ $json.intermediador }}`

| Saída | Condição | Vai para |
|---|---|---|
| 0 | equals `Melhor Envio` | HTTP Melhor Envio |
| 1 | equals `Manda Bem` | HTTP Manda Bem |
| Fallback | — | NoOp "sem fonte" |

Repare que o roteamento é por **intermediador**, não por transportadora. A
transportadora (`transp`) serve para exibir no card e para o eventual
caminho direto do item 2 da seção 1 — mas quem responde a consulta é o
intermediador.

### 2.5 HTTP Request — exemplo Melhor Envio

- **Method**: `POST`
- **URL**: `https://melhorenvio.com.br/api/v2/me/shipment/tracking`
- **Authentication**: Header `Authorization: Bearer {{ $credentials.token }}`
- **Headers**: `Accept: application/json`, `Content-Type: application/json`,
  `User-Agent: LiveOps (contato@suplelive.com.br)` — eles pedem User-Agent
  identificado
- **Body**: `{ "orders": ["{{ $json.envioId }}"] }`
- **Settings**: ligue **Always Output Data** e **Continue On Fail** — um
  código inválido não pode derrubar a rodada inteira dos outros 40 pacotes
- **Batching**: 1 requisição a cada 2s, para não tomar 429

Valide o token contra o **sandbox** antes de apontar para produção.

### 2.6 Gravar de volta no LiveOps

- **Method**: `PATCH`
- **URL**:
  ```
  https://suplelive-8a700-default-rtdb.firebaseio.com/suplelive/reg/rastreios/{{ $json.chave }}.json
  ```
- **Body**: só os campos de rastreio (ver seção 3). `PATCH` mescla: os campos
  que a equipe preenche na tela (cliente, observação, previsão) não são
  tocados.

**Sempre inclua `"_by": "n8n"` no corpo.** O LiveOps ignora mudanças cuja
marca `_by` seja a da própria sessão; com `"n8n"` ali, todos os navegadores
aplicam a atualização — e a auditoria registra que quem mexeu foi a
automação, não uma pessoa.

---

## 3. Campos que o card ganha

O registro do rastreio hoje tem `id`, `data`, `nped`, `marketplace`,
`status`, `transp`, `previsao`, `cliente`, `codigo`, `link`, `obs`. O n8n
acrescenta:

| Campo | Tipo | Para que serve |
|---|---|---|
| `intermediador` | texto | `Melhor Envio` ou `Manda Bem`. É o que roteia o Switch. |
| `envioId` | texto | Id do envio no intermediador. **O Melhor Envio consulta por ele, não pelo código da transportadora.** |
| `trackStatus` | texto | Status cru da transportadora ("Objeto saiu para entrega"). |
| `trackHistorico` | lista | Movimentações: `{data, status, local, detalhe}`. |
| `trackConsultadoEm` | texto | `17/08/2026, 14:07` — quando o robô perguntou. |
| `trackFonte` | texto | Quem respondeu (`melhor-envio`, `manda-bem`, `17track`). |
| `trackErro` | texto | Último erro, vazio quando deu certo. |
| `trackFalhas` | número | Falhas seguidas. Zera no primeiro sucesso. |
| `trackProximaConsulta` | número | Timestamp — antes disso, não pergunte de novo. |

### Por que `status` e `trackStatus` são separados

`status` é o campo operacional da equipe (`Enviado`, `Extraviado`, `Endereço
errado`, `Voltando`) e alimenta os filtros e as cores da tela. `trackStatus`
é o que a transportadora disse, com as palavras dela.

O robô só encosta no `status` da equipe **em um caso**: quando a
transportadora confirma a entrega. Aí ele grava `status: "Entregue"` e
`entregueEm`, que é o que faz o card sair da lista ativa e ir para a pasta
Entregues — exatamente como acontece quando alguém marca na mão.

Nos demais casos ele não sobrescreve: se a equipe marcou "Endereço errado" e
a transportadora ainda diz "em trânsito", quem sabe da história é a equipe.

---

## 4. Regras de negócio e otimização

### Não consultar o que já acabou
`status === 'Entregue'` sai da fila na seção 2.3. Sem isso, em três meses o
workflow gastaria a maior parte das chamadas perguntando sobre pacotes
entregues em maio.

### Backoff progressivo no erro
Erro de rede e API fora do ar acontecem. O que não pode acontecer é o
workflow bater de hora em hora, para sempre, num código que não existe:

| Falhas seguidas | Próxima tentativa |
|---|---|
| 1 | +1h (ritmo normal) |
| 2 | +3h |
| 3 | +6h |
| 4 | +12h |
| 5 ou mais | +24h, e o card mostra a pendência |

Depois de 5 falhas o problema não é temporário — é código errado, envio
cancelado ou credencial vencida. Aí o certo é aparecer para uma pessoa
resolver, não continuar tentando.

### Só gravar o que mudou
Antes do PATCH, compare o histórico novo com o que já está no card. Se for
igual, não grave. Cada gravação dispara `child_changed` em todos os
navegadores abertos e uma linha de auditoria — 300 rastreios reescritos de
hora em hora viram 7.200 eventos por dia sem nenhuma informação nova.

### Respeitar o limite das APIs
`Split In Batches` de 10 + `Wait` de 2s entre lotes. É melhor a rodada levar
três minutos do que tomar 429 e perder a hora inteira.

### Pacote parado há 45 dias
Sai da fila automática. Não é o robô que vai resolver.

---

## 5. O Code Node que unifica as respostas

Cada fonte responde com um formato diferente. Este nó traduz todas para uma
estrutura só — o resto do workflow (e o LiveOps) não precisa saber de onde
veio.

```javascript
/**
 * Padroniza a resposta de qualquer fonte de rastreio.
 *
 * Saída (uma por item):
 *   status_atual          — o último status, em texto
 *   historico_movimentacoes — [{data, status, local, detalhe}], mais novo primeiro
 *   data_hora_consulta    — quando perguntamos
 *
 * A leitura de cada formato é defensiva de propósito: transportadora muda
 * nome de campo sem avisar, e é melhor gravar um histórico incompleto do que
 * derrubar a rodada com "cannot read property of undefined".
 */

const TZ = 'America/Sao_Paulo';

const agora = new Date();
const carimbo = agora.toLocaleString('pt-BR', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit'
});

/* "2026-08-17T14:07:00Z" | "17/08/2026 14:07" | Date → "17/08/2026, 14:07"
   O formato de saída é sempre o mesmo, com vírgula. Isso não é capricho: a
   comparação "mudou desde a última consulta?" é feita sobre esse texto, e
   "17/08/2026 08:00" contra "17/08/2026, 08:00" seria lido como movimentação
   nova a cada hora — o card seria reescrito para sempre, sem nada ter
   acontecido. */
function paraDataBR(valor) {
  if (!valor) return '';
  const br = String(valor).match(/^(\d{2})\/(\d{2})\/(\d{4})[,\s]*(\d{2}):(\d{2})?/);
  if (br) return `${br[1]}/${br[2]}/${br[3]}, ${br[4]}:${br[5] || '00'}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(valor).trim())) return String(valor).trim();
  const d = new Date(valor);
  if (isNaN(d.getTime())) return String(valor);
  return d.toLocaleString('pt-BR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function primeiro(obj, ...campos) {
  for (const c of campos) {
    const v = c.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

// ── Um evento, venha de onde vier ────────────────────────────
function normalizarEvento(e) {
  return {
    data:    paraDataBR(primeiro(e, 'created_at', 'date', 'dtHrCriado', 'data', 'occurredAt', 'time_iso', 'datetime')),
    status:  primeiro(e, 'status', 'descricao', 'description', 'situacao', 'title', 'event', 'message'),
    local:   primeiro(e, 'location', 'local', 'city', 'unidade.endereco.cidade', 'cidade', 'origem'),
    detalhe: primeiro(e, 'detail', 'detalhe', 'comment', 'observacao', 'sub_status')
  };
}

// ── Cada fonte devolve os eventos num lugar diferente ────────
function eventosDaFonte(fonte, resposta) {
  if (!resposta) return [];
  switch (fonte) {
    case 'melhor-envio': {
      // { "<id>": { tracking, status, events: [...] } }
      const primeiroPedido = Object.values(resposta)[0] || {};
      return primeiroPedido.events || primeiroPedido.tracking_events || [];
    }
    case 'manda-bem':
      return resposta.eventos || resposta.events || resposta.tracking || [];
    case 'correios': {
      const obj = (resposta.objetos && resposta.objetos[0]) || {};
      return obj.eventos || [];
    }
    case 'jadlog': {
      const doc = (resposta.consulta && resposta.consulta[0] && resposta.consulta[0].tracking) || {};
      return doc.eventos || [];
    }
    case '17track': {
      const aceito = resposta.data && resposta.data.accepted && resposta.data.accepted[0];
      return (aceito && aceito.track && aceito.track.z1) || [];
    }
    default:
      // Formato desconhecido: procura a primeira lista de objetos que existir
      const lista = Object.values(resposta).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object');
      return lista || [];
  }
}

// ── "Entregue" escrito de todo jeito ─────────────────────────
const PALAVRAS_ENTREGUE = /(entregue|delivered|entrega\s+realizada|objeto\s+entregue)/i;
const PALAVRAS_PROBLEMA = /(extravi|roubo|avaria|devolu|recusad|endere[çc]o\s+(insuficiente|incorreto|errado))/i;

const saida = [];

for (const item of $input.all()) {
  const card  = item.json.card || item.json;          // o registro do LiveOps
  const fonte = item.json.fonte || 'desconhecida';
  const bruto = item.json.resposta;

  // Ramo de erro: o HTTP Request falhou (Continue On Fail preserva o item)
  if (item.json.error || !bruto) {
    const falhas = Number(card.trackFalhas || 0) + 1;
    const espera = [1, 3, 6, 12, 24][Math.min(falhas, 5) - 1] * 3600e3;
    saida.push({ json: {
      chave: card.chave || card.id,
      mudou: true,
      patch: {
        trackErro: String(item.json.error || 'sem resposta da API').slice(0, 300),
        trackFalhas: falhas,
        trackConsultadoEm: carimbo,
        trackProximaConsulta: Date.now() + espera,
        _by: 'n8n'
      }
    }});
    continue;
  }

  const eventos = eventosDaFonte(fonte, bruto)
    .map(normalizarEvento)
    .filter(e => e.status || e.data);

  // Mais novo primeiro — é a ordem que o card mostra
  eventos.sort((a, b) => {
    const t = s => {
      const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2})/);
      return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime() : 0;
    };
    return t(b.data) - t(a.data);
  });

  const status_atual = eventos.length
    ? eventos[0].status
    : primeiro(bruto, 'status', 'situacao', 'current_status') || 'Sem movimentação';

  const padrao = {
    status_atual,
    historico_movimentacoes: eventos,
    data_hora_consulta: carimbo
  };

  // Mudou desde a última consulta? Compara pelo conteúdo, não pelo horário —
  // senão toda rodada pareceria uma novidade e reescreveria o card à toa.
  const antes = JSON.stringify((card.trackHistorico || []).map(e => e.data + e.status));
  const depois = JSON.stringify(eventos.map(e => e.data + e.status));
  const mudou = antes !== depois || card.trackStatus !== status_atual;

  const patch = {
    trackStatus: padrao.status_atual,
    trackHistorico: padrao.historico_movimentacoes,
    trackConsultadoEm: padrao.data_hora_consulta,
    trackFonte: fonte,
    trackErro: '',
    trackFalhas: 0,
    trackProximaConsulta: 0,
    _by: 'n8n'
  };

  // Entrega confirmada é o único caso em que o robô mexe no status da equipe:
  // é o que tira o card da lista ativa, como se alguém tivesse marcado.
  if (PALAVRAS_ENTREGUE.test(status_atual)) {
    patch.status = 'Entregue';
    patch.entregueEm = eventos[0] ? eventos[0].data : carimbo;
  } else if (PALAVRAS_PROBLEMA.test(status_atual)) {
    // Problema NÃO vira status automático: quem decide entre "Extraviado",
    // "Voltando" e "Endereço errado" é quem fala com o cliente. O robô só
    // sinaliza para o card acender.
    patch.trackAlerta = status_atual;
  }

  saida.push({ json: { chave: card.chave || card.id, mudou, patch, padrao } });
}

return saida;
```

---

## 6. Antes de ligar em produção

1. **Rode com um pacote só.** Filtre a fila por um `nped` conhecido, deixe
   rodar uma hora e confira o card na tela.
2. **Confirme o `envioId`.** Sem ele, o Melhor Envio não tem como responder.
   Se os envios antigos não têm esse dado, o rastreio automático só vale
   para os novos — e os antigos seguem no processo manual até acabarem.
3. **Desligue o PATCH na primeira rodada** (troque por um NoOp) e olhe o que
   sairia. É mais barato conferir o JSON no n8n do que despoluir 300 cards.
4. **Combine o alarme.** Se o workflow falhar inteiro (credencial vencida,
   por exemplo), alguém precisa saber. Um nó de erro que cria uma tarefa no
   LiveOps para o responsável resolve — o mesmo caminho do `n8n-tarefas.md`.
