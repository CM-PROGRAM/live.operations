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

- **Melhor Envio**: API oficial documentada, OAuth2. O rastreio é consultado
  pelo **id do pedido no Melhor Envio**, não pelo código da transportadora —
  e esse id é chato de pegar no painel, envio a envio. Por isso o workflow o
  **descobre sozinho**: busca o pedido pelo código de rastreio que o card já
  tem e, achando, grava o id no próprio card. Da segunda rodada em diante vai
  direto, sem a busca.
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
[Abrir tela de login] → [Extrai o _token] → [Login] → [Guardar cookie]
        │
        │  Em fila, não em paralelo: o n8n não garante a ordem entre dois
        │  ramos que saem do gatilho, e os nós do painel precisam do cookie
        │  já pronto. Em paralelo, o rastreio corria antes do login e morria
        │  com "o nó referenciado não foi executado".
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

    // Painel do Manda Bem: {title, html} — as movimentações estão no HTML
    case 'manda-bem-painel':
      return eventosDoPainelMandaBem(resposta.html || resposta);

    /* Portais (rota B da seção 6). O JSON interno de cada um tem nome próprio
       para a lista de eventos, e ninguém garante que continue o mesmo no mês
       que vem — por isso a busca é por vários nomes, e não por um caminho
       fixo. Se todos falharem, o último recurso varre o objeto atrás de
       qualquer lista que pareça uma linha do tempo. */
    case 'portal-correios':
    case 'portal-loggi':
    case 'portal-melhorrastreio': {
      const candidatos = [
        resposta.eventos, resposta.events, resposta.tracking, resposta.trackings,
        resposta.historico, resposta.history, resposta.movimentacoes, resposta.checkpoints,
        resposta.data && resposta.data.eventos,
        resposta.data && resposta.data.events,
        resposta.data && resposta.data.tracking,
        resposta.result && resposta.result.eventos,
        resposta.objeto && resposta.objeto.eventos,
        // Nó HTML do n8n: as linhas já vêm quebradas em texto
        resposta.linhas
      ];
      for (const c of candidatos) if (Array.isArray(c) && c.length) return c;
      return acharListaDeEventos(resposta);
    }

    default:
      return acharListaDeEventos(resposta);
  }
}

/* Manda Bem devolve HTML dentro de JSON: {title, html}. Cada movimentação
   começa com "Em DD/MM/AAAA HH:MM:SS", seguida da descrição, e há uma coluna
   "Local". A leitura é por essa marca de data, não por seletor de tabela —
   o painel mexe no layout com frequência, mas a data é o que dá sentido ao
   evento e não vai mudar de formato sem quebrar a tela deles também. */
function textoSemTags(t) {
  return String(t || '')
    .replace(/<[^>]*>/g, '\n')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function eventosDoPainelMandaBem(html) {
  const texto = String(html || '');
  const marca = /Em\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})(?::\d{2})?/g;
  const marcos = [];
  let m;
  while ((m = marca.exec(texto)) !== null) {
    marcos.push({ inicio: m.index, fim: marca.lastIndex, data: m[1] + ', ' + m[2] });
  }
  return marcos.map((mk, i) => {
    const trecho = texto.slice(mk.fim, i + 1 < marcos.length ? marcos[i + 1].inicio : texto.length);
    const linhas = textoSemTags(trecho);
    const iLocal = linhas.findIndex(l => /^local:?$/i.test(l));
    // A primeira linha que não é o rótulo "Local" é a descrição do evento
    const status = linhas.find((l, k) => k !== iLocal && !/^local:?$/i.test(l)) || '';
    const local = iLocal >= 0 ? (linhas[iLocal + 1] || '') : '';
    return { data: mk.data, status, local, detalhe: '' };
  }).filter(e => e.status);
}

/* Último recurso: vasculha o objeto inteiro atrás da lista que mais parece
   uma linha do tempo — a que tem mais itens com cara de data. Serve para
   quando o portal troca o nome do campo sem avisar: em vez de devolver zero
   evento e o card congelar, ainda se acerta o histórico. */
function acharListaDeEventos(raiz) {
  let melhor = [], nota = 0;
  const parecemData = /^\d{4}-\d{2}-\d{2}|^\d{2}\/\d{2}\/\d{4}/;

  (function varrer(o, nivel) {
    if (!o || typeof o !== 'object' || nivel > 6) return;
    if (Array.isArray(o)) {
      if (o.length && typeof o[0] === 'object') {
        const pontos = o.filter(e => e && Object.values(e).some(
          v => typeof v === 'string' && parecemData.test(v))).length;
        if (pontos > nota) { nota = pontos; melhor = o; }
      }
      o.forEach(v => varrer(v, nivel + 1));
      return;
    }
    Object.values(o).forEach(v => varrer(v, nivel + 1));
  })(raiz, 0);

  return melhor;
}

// ── "Entregue" escrito de todo jeito ─────────────────────────
const PALAVRAS_ENTREGUE = /(entregue|delivered|entrega\s+realizada|objeto\s+entregue)/i;
const PALAVRAS_PROBLEMA = /(extravi|roubo|avaria|devolu|recusad|endere[çc]o\s+(insuficiente|incorreto|errado))/i;

/* Este nó roda UMA VEZ POR ITEM. O card não vem no item: o nó HTTP anterior
   substituiu o conteúdo pela resposta da API. Quem guarda o registro original
   é o nó de lotes, e o n8n sabe casar cada resposta com a entrada que a
   originou — é daí que o card é lido. */
{
  const card  = $('Lotes de 10').item.json;
  const item  = { json: $json };
  // A fonte se reconhece pela cara da resposta: o painel do Manda Bem devolve
  // {title, html}; o Melhor Envio, um objeto por pedido
  const fonte = ($json && $json.html !== undefined) ? 'manda-bem-painel' : 'melhor-envio';
  const bruto = ($json && $json.error) ? null : $json;

  // Ramo de erro: o HTTP Request falhou (Continue On Fail preserva o item)
  if (item.json.error || !bruto) {
    const falhas = Number(card.trackFalhas || 0) + 1;
    const espera = [1, 3, 6, 12, 24][Math.min(falhas, 5) - 1] * 3600e3;
    return { json: {
      chave: card.chave || card.id,
      mudou: true,
      patch: {
        trackErro: String(item.json.error || 'sem resposta da API').slice(0, 300),
        trackFalhas: falhas,
        trackConsultadoEm: carimbo,
        trackProximaConsulta: Date.now() + espera,
        _by: 'n8n'
      }
    }};
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

  /* Sem evento datado, ainda pode haver recado: o painel do Manda Bem
     responde "Objeto aguardando postagem." como texto solto, sem data. Jogar
     isso fora e escrever "Sem movimentação" seria apagar a única informação
     que veio. */
  const recado = bruto && bruto.html ? (textoSemTags(bruto.html)[0] || '') : '';
  const status_atual = eventos.length
    ? eventos[0].status
    : (primeiro(bruto, 'status', 'situacao', 'current_status') || recado || 'Sem movimentação');

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

  /* O id do pedido no Melhor Envio é caro de descobrir (uma busca a mais).
     Achado uma vez, é gravado no card — nas próximas rodadas vai direto. */
  if (!card.envioId) {
    try {
      const achado = $('Id do pedido').item.json.envioId;
      if (achado) patch.envioId = achado;
    } catch (e) { /* rodada do Manda Bem: este nó não existe no caminho */ }
  }

  return { json: { chave: card.chave || card.id, mudou, patch, padrao } };
}
```

---

## 6. Rota B — consultar pelos portais

O Manda Bem não expõe API. Para os envios criados lá, o jeito é o portal
mesmo. Esta seção é o desenho dessa rota.

### 6.1 Primeiro, o tamanho real do problema

Vale medir antes de construir, porque a conta muda tudo:

| Intermediador | Transportadoras | Como consultar |
|---|---|---|
| **Melhor Envio** | J&T, Loggi, Jadlog, Correios PAC/SEDEX, Azul | **API oficial** — resolve as seis |
| **Manda Bem** | Loggi, Jadlog, Correios PAC/SEDEX | Portal |

Ou seja: a rota dos portais não precisa cobrir seis transportadoras e quatro
sites. Precisa cobrir **o que saiu pelo Manda Bem** — e só. Se hoje a maior
parte do volume sai pelo Melhor Envio, a rota B fica pequena, e cada portal
que sair dela é um a menos para consertar quando quebrar.

Faça a contagem antes: quantos envios ativos são Manda Bem, e de quais
transportadoras. Pode ser que sobre só Correios, e aí é um portal, não
quatro.

### 6.2 Capturar o endereço real de cada portal

Os quatro sites são aplicações JavaScript: a página que você vê é montada no
navegador a partir de uma chamada JSON por baixo. **Ler o HTML é o caminho
frágil; chamar essa mesma chamada JSON é o caminho estável.** O layout muda
toda semana; o JSON de dados muda raramente.

Como achar, em cada portal (leva uns dois minutos):

1. Abra o portal no Chrome e pressione **F12** → aba **Network**
2. Marque o filtro **Fetch/XHR** e clique em **🚫** para limpar a lista
3. Faça uma consulta normal, com um código de rastreio de verdade
4. Na lista, procure a linha cuja resposta traz as movimentações — clique e
   veja a aba **Response** até achar o JSON com as datas e status
5. Clique com o botão direito nessa linha → **Copy** → **Copy as cURL**

No n8n: novo nó **HTTP Request** → **Import cURL** → cole. Ele preenche URL,
método, headers e corpo sozinho. Depois é só trocar o código de rastreio fixo
por `{{ $json.codigo }}`.

Faça isso uma vez para cada portal que sobrou na conta da seção 6.1 e anote
aqui embaixo:

```
Melhor Rastreio (J&T, Azul) →  método: ____  URL: ______________________
Loggi                        →  método: ____  URL: ______________________
Site Rastreio (Correios)     →  método: ____  URL: ______________________
```

### 6.2.1 Manda Bem — descoberto

Não precisa dos portais das transportadoras para o que sai pelo Manda Bem: o
painel deles tem endpoint próprio de rastreio, um por transportadora.

Ele aparece no HTML do detalhe do envio, no botão da lupa "Consultar":

```html
<a class="btn-get-status-objeto-envio"
   data-path="https://painel.mandabem.com.br/acompanhamento/status_loggi_objeto/328080">
```

Então o padrão é:

```
https://painel.mandabem.com.br/acompanhamento/status_<transportadora>_objeto/<id>
```

Dois detalhes que mudam o desenho:

1. **O id não é o código de rastreio, nem o número da lista.** É o número da
   **etiqueta** sem o prefixo: `MB0000000328080` → `328080`. É esse id que o
   card precisa guardar no campo `envioId` — sem ele, não há como consultar.

   Cuidado com os dois números parecidos do mesmo envio:

   | Número | O que é | Serve? |
   |---|---|---|
   | `4600136` | id da **coleta** — é o que aparece na lista e no `id="coleta-…"` | não |
   | `328080` | id da **etiqueta** — vem de `MB0000000328080` | sim |

   Usar o da coleta devolve `404`, o que dá a impressão de que o nome do
   endpoint está errado quando o errado é o id.
2. **A resposta é HTML dentro de JSON** (`{"html": "<div>…</div>"}`), porque
   o painel joga esse HTML num modal. O normalizador precisa de um adaptador
   que leia os eventos do HTML, não de um JSON já estruturado.

**Confirmado**: o endpoint responde a `GET` simples, autenticado só pelo
cookie de sessão do painel. Abrir a URL no navegador logado já devolve o
JSON. A resposta tem esta cara:

```json
{
  "title": "Movimentações do Objeto",
  "html": "… <strong>Em 14/08/2026 18:06:30</strong><br> A etiqueta de envio
           já foi criada e o pacote está pronto para a coleta. …
           <strong>Local</strong><br> Palmas/TO …"
}
```

Cada movimentação começa com **`Em DD/MM/AAAA HH:MM:SS`**, seguida da
descrição, e o local vem sob o rótulo `Local`. O adaptador
`manda-bem-painel` da seção 5 lê exatamente isso — por essa marca de data, e
não por seletor de tabela: o painel mexe no layout com frequência, mas a data
é o que dá sentido ao evento e não muda de formato sem quebrar a tela deles
junto.

### Não mapeie transportadora → endpoint. Leia o `data-path`.

Comparando três envios do mesmo painel:

| Envio | `data-path` da lupa | Cancelar | De onde vem o id |
|---|---|---|---|
| Loggi | `/acompanhamento/status_loggi_objeto/328080` | `/transportadora/cancel/328080` | etiqueta `MB0000000328080` |
| Jadlog | `/acompanhamento/status_jadlog_objeto/326447` | `/transportadora/cancel/326447` | `PED: 4596457MBEM326447` |
| Correios | `/acompanhamento/status_objeto/12411416` | `/envio/cancel/12411416` | `data-envio_id` |

São **duas famílias de rota**:

- **Transportadora própria** (Loggi, Jadlog) — `status_<transp>_objeto/{id}`,
  com o id que também aparece em `/transportadora/cancel/`.
- **Correios** — `status_objeto/{envio_id}`, sem nome de transportadora, com
  o id que aparece em `/envio/cancel/`.

E cada família guarda o id num lugar diferente do HTML: na Loggi ele está
embutido na etiqueta `MB…`, no Jadlog no texto `PED: …MBEM326447`, nos
Correios num atributo `data-envio_id`. Três formatos para a mesma coisa.

Dá para escrever um extrator para cada um — e ele quebra no dia em que
entrar uma transportadora nova. Por isso a regra abaixo.

Qualquer tabela "transportadora → slug" que eu escrevesse aqui estaria
errada na próxima transportadora que vocês usarem. O caminho que não quebra é
**perguntar ao painel**: o HTML do detalhe do envio já traz o endereço pronto
no `data-path`.

Então o fluxo do Manda Bem tem dois passos:

```
[GET detalhe da coleta]  →  HTML com o data-path da lupa
        │
[Code: extrai o data-path]
        │
[GET esse data-path]     →  {title, html} com as movimentações
```

Extrair é uma linha:

```javascript
// O HTML do detalhe traz o botão da lupa com o endereço do rastreio pronto.
// Ler daqui vale mais que qualquer tabela de slugs: funciona para
// transportadora que ainda nem existe no cadastro.
const html = $json.html || '';
const m = html.match(/class="btn-get-status-objeto-envio"[^>]*data-path="([^"]+)"/)
       || html.match(/data-path="([^"]*status[^"]*objeto[^"]*)"/);
return [{ json: { ...$json, trackUrl: m ? m[1].replace(/\\\//g, '/') : '' } }];
```

**Endpoint do detalhe (confirmado)**, achado no JS da página:

```javascript
$.ajax({ url: "https://painel.mandabem.com.br/coleta/get_envios_row/" + coleta_id, ... })
```

Ou seja, basta o **id da coleta** — o número que já aparece na lista de
etiquetas geradas (`4600136`). É o único id que o card precisa guardar: dele
sai o HTML, do HTML sai o `data-path`, e do `data-path` saem as movimentações,
seja qual for a transportadora.

### O endpoint não confere a transportadora — e isso é uma armadilha

Testando o mesmo objeto (`328080`, que é **Loggi**) contra os outros nomes:

| URL | Resposta |
|---|---|
| `status_loggi_objeto/328080` | as movimentações certas |
| `status_jadlog_objeto/328080` | `{"html":"Objeto aguardando postagem."}` |
| `status_correios_objeto/328080` | `404 Não encontrado` |

O Jadlog **respondeu 200** para um objeto que não é dele. Não é rastreio: é o
que aquela rota diz quando não acha nada. Se o workflow apontar para o slug
errado, o card vai mostrar "Objeto aguardando postagem" para sempre — uma
resposta plausível, com cara de certa, e completamente falsa. É o pior tipo
de erro, e é silencioso.

**Portanto: o slug tem de casar com a transportadora do card.** Nada de
tentar um e cair para o outro.

O `404` do Correios provavelmente é só o nome diferente (`status_correio_objeto`
no singular, ou outro), mas **não vale chutar** — pela tabela acima, chute
errado dá resposta convincente. O jeito certo é ler o `data-path` da lupa num
envio de Correios de verdade:

1. No painel, expanda um envio cuja transportadora seja Correios
2. Clique com o botão direito na lupa 🔍 → **Inspecionar**
3. No HTML destacado, leia o `data-path="…"`

Mesma coisa para um envio Jadlog de verdade, para confirmar que
`status_jadlog_objeto` é mesmo o nome dele — o teste acima não prova isso,
só provou que a rota existe.

### 6.2.2 A sessão do painel

O endpoint depende do cookie de login, e cookie expira. Dois caminhos:

1. **Login programático no início da rodada** — um nó `HTTP Request` faz o
   POST no login do painel, guarda o cookie da resposta e os nós seguintes o
   reaproveitam. É o caminho estável, e funciona enquanto o login não tiver
   captcha.
2. **Cookie colado à mão numa credencial do n8n** — funciona hoje e quebra
   quando expirar, virando tarefa recorrente para alguém.

Comece pelo 1. Se o login tiver captcha, o 2 é o que sobra — e aí vale
combinar com a equipe quem renova, para o rastreio não morrer em silêncio.
O sintoma de cookie vencido é resposta de login no lugar do JSON: o
normalizador cai no ramo de erro e o card mostra a falha, que é como isso
tem de aparecer.

> Note que isso também resolve o Jadlog do Manda Bem sem captcha: quem
> consulta a Jadlog é o painel do Manda Bem, com o contrato deles. O captcha
> de `jadlog.com.br` deixa de ser problema para esses envios.

> Não vou inventar essas URLs neste documento. Endpoint interno não é
> documentado nem estável, e escrever aqui um que eu não verifiquei faria o
> workflow falhar em produção com a aparência de estar certo — o pior tipo de
> erro, que é o que parece funcionar.

### 6.3 Quando não houver JSON: ler o HTML

Se algum portal montar tudo no servidor, use o nó **HTML** do n8n
(*Extract HTML Content*) em vez de regex:

- **Operation**: `Extract HTML Content`
- **Source Data**: `JSON`, **JSON Property**: `data`
- **Extraction Values**: chave `linhas`, **CSS Selector** da linha de evento
  (ex.: `.tracking-event`), **Return Value**: `HTML`, **Return Array**: ligado

Depois um Code Node quebra cada linha em data/status/local. Anote o seletor
usado — quando o portal mudar o layout, é a única linha que precisa mudar.

### 6.4 Jadlog: o captcha

`jadlog.com.br/jadlog/captcha` tem captcha porque não quer robô. Só há três
saídas honestas:

1. **Não consultar Jadlog pelo portal.** O Jadlog que sai pelo Melhor Envio
   já vem pela API. Sobra o Jadlog do Manda Bem — se for pouco volume, segue
   manual e pronto.
2. **Serviço de resolução de captcha** (2Captcha, Anti-Captcha). Custa
   centavos por consulta, adiciona 10–30s por pacote e é mais uma peça para
   quebrar.
3. **Navegador como serviço** (Browserless, ScrapingBee, ScraperAPI). Renderiza
   a página, resolve captcha e devolve o HTML pronto. É o caminho que menos
   quebra, porque quem mantém a raspagem de pé é o fornecedor — mas é pago e
   mensal.

Minha recomendação: comece pela 1. Só pague pela 3 se a contagem da seção
6.1 mostrar volume de Jadlog/Manda Bem que justifique.

### 6.5 Higiene para não ser bloqueado

Portal não é API: ele não espera robô, e reage.

- **Um pacote de cada vez, com pausa.** `Split In Batches` de 5 + `Wait` de
  3–5 segundos. Quarenta consultas em rajada de um IP só é o retrato de um
  robô e leva bloqueio no primeiro dia.
- **User-Agent de navegador de verdade** e `Accept-Language: pt-BR`.
  Requisição sem User-Agent é recusada por padrão em vários portais.
- **`Continue On Fail` ligado** em todos os nós de portal. Um site fora do ar
  não pode derrubar a rodada dos outros.
- **IP fixo ajuda e atrapalha.** Se o n8n estiver em nuvem, o IP é
  compartilhado e já pode estar queimado por outros. Se estiver em servidor
  próprio, o IP é seu — e o bloqueio também.
- **Não paralelize.** Tentar acelerar com execuções simultâneas é o jeito
  mais rápido de perder o acesso ao portal.

### 6.6 O que muda no workflow

Nada da estrutura. O `Switch` da seção 2.4 ganha as saídas por portal, e a
fonte informada ao normalizador muda:

| Saída do Switch | Condição | Fonte | Chamada |
|---|---|---|---|
| 0 | `intermediador` = `Melhor Envio` | `melhor-envio` | API oficial (seção 2.5) |
| 1 | `intermediador` = `Manda Bem` | `manda-bem-painel` | `GET /acompanhamento/status_<transp>_objeto/{{ $json.envioId }}` |
| Fallback | — | — | marca pendência no card |

No ramo do Manda Bem, o trecho `<transp>` sai da transportadora do card:
`loggi`, `correios` ou `jadlog` — dá para montar com uma expressão
(`{{ $json.transp.toLowerCase().includes('correios') ? 'correios' : ... }}`)
ou com um Switch interno, o que ficar mais legível para quem for manter.

Repare que **não sobrou nenhum portal de transportadora**: o Melhor Envio
responde pela API e o Manda Bem pelo painel dele. Os quatro sites da lista
original saíram do desenho — inclusive o do captcha.

O normalizador da seção 5 já trata isso: os adaptadores `portal-*` estão em
`eventosDaFonte`, e o resto do fluxo — comparar se mudou, backoff, marcar
entregue — funciona igual, venha o dado de API ou de portal.

### 6.7 O que esperar dessa rota, honestamente

Vai funcionar, e vai quebrar de vez em quando — quando o portal mudar o
layout ou o endereço da chamada interna. Quando quebrar, o sintoma é o
`trackErro` no card e o contador de falhas subindo; conserta-se recapturando
o endpoint pela seção 6.2.

Por isso a seção 4 insiste no alerta: **o pior cenário não é o workflow
falhar, é ele parar de trazer novidade sem ninguém perceber.** Com o
`trackConsultadoEm` no card, qualquer pessoa vê que a última consulta foi há
dois dias e sabe que tem algo errado.

---

## 7. O workflow pronto para importar

`n8n-live-track-workflow.json`, ao lado deste arquivo. No n8n: menu **⋯** →
**Import from File**.

São 15 nós, com todo o código já dentro. **Duas coisas ficam marcadas com
`PREENCHER`** — são as únicas que faltam descobrir:

| Nó | O que falta |
|---|---|
| `Login Manda Bem` | trocar `PREENCHER_A_SENHA_AQUI` pela senha do painel |
| `Melhor Envio · rastreio` e `Melhor Envio · achar pedido` | escolher a credencial de cabeçalho criada com o token |
| `Ler Live Track` e `Gravar no LiveOps` | escolher a credencial da conta de serviço do Google |

E, nos cards do Live Track, preencher **Intermediador** — é ele que decide o
caminho. Para o Manda Bem, preencher também o **Id no intermediador** com o
número da coleta; para o Melhor Envio, deixar vazio que o robô descobre.

### Onde ficam as credenciais (sem plano pago)

As *Variáveis* do n8n são recurso Enterprise, então o workflow não depende
delas. Ficou assim:

| O quê | Onde | Por quê |
|---|---|---|
| Token do Melhor Envio | Credencial **Autenticação de cabeçalho** (`Authorization` = `Bearer <token>`) | credencial é criptografada pelo n8n e não sai no export do workflow |
| Senha do Manda Bem | No próprio nó `Login Manda Bem` | o painel espera a senha no corpo do POST, e credencial do n8n só injeta em cabeçalho |
| E-mail do Manda Bem | No próprio nó | não é segredo |

Trocar o token do Melhor Envio depois é editar a credencial, sem tocar no
workflow.

**A senha no nó tem uma consequência:** ela viaja junto se alguém exportar
este workflow. Ao compartilhar o JSON, apague a senha antes. (Se o n8n for
auto-hospedado, dá para trocar por `{{ $env.MANDABEM_SENHA }}` e pôr o valor
no `.env` do servidor — aí ela não fica no workflow.)

O login roda uma vez por rodada, em paralelo com a leitura dos cards, e o
cookie fica guardado para os nós do painel. Como o login não tem captcha,
isso se renova sozinho — ninguém precisa colar cookie quando expirar.

---

## 8. Antes de ligar em produção

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
