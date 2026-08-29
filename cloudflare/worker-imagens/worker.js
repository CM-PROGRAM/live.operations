/* LiveOps — Worker da migração Cloudflare (R2 + D1 + tempo real)
   ===============================================================
   Etapa 1 — IMAGENS:    guarda e serve as imagens originais no R2.
   Etapa 2 — DADOS:      recebe o espelho de tudo que o sistema grava no
                         Firebase — registros no D1, pacote de estado no R2.
   Etapa 4 — TEMPO REAL: leitura dos dados espelhados + a "sala" (Durable
                         Object com WebSocket) que avisa todo navegador
                         conectado quando algo muda — a peça que um dia
                         substitui o tempo real do Firebase.

   IMPORTANTE: nada aqui substitui o Firebase ainda — é cópia e ensaio em
   paralelo. O sistema continua gravando e lendo no Firebase; se este
   worker cair, nada muda para quem usa.

   Rotas (todas exigem o login do sistema, exceto /saude):
     GET    /saude                  → "ok" (teste de publicação)
     GET    /img/<chave>            → a imagem (binário, content-type original)
     PUT    /img/<chave>            → grava (corpo = dataURL)
     DELETE /img/<chave>            → remove
     GET    /lista                  → chaves de imagem guardadas
     PUT    /dados/pacote/<nome>    → grava um pacote inteiro (JSON) no R2
     GET    /dados/pacote/<nome>    → devolve o pacote
     POST   /dados/lote             → grava/apaga registros no D1 em lote
                                      corpo: {linhas:[{colecao,chave,dados|null},…]}
     GET    /dados/registro?colecao=X&chave=Y          → um registro
     GET    /dados/colecao?nome=X&depois=K&limite=N    → página de registros
     GET    /dados/resumo           → contagem por coleção + pacotes guardados
     GET    /rt?token=<token>       → WebSocket da sala de tempo real
                                      (o token vai na URL porque WebSocket de
                                      navegador não envia cabeçalhos)

   A sala transmite para todos os conectados:
     {t:'mudanca', linhas:[{colecao,chave,apagada?}…]}  — registros que mudaram
     {t:'mudanca', pacote:'state'}                      — o pacote foi regravado
     {t:'mudanca', img:'<chave>', apagada?}             — imagem gravada/removida
     {t:'presenca', lista:[{uid,nome}…]}                — quem está na sala
   E responde {t:'pong'} a {t:'ping'} sem nem acordar (auto-resposta).

   Segurança: o MESMO login do sistema. O navegador manda o token do
   Firebase Auth (Authorization: Bearer ...) e o worker confere a
   assinatura contra as chaves públicas do Google — o equivalente às
   regras do banco exigirem "auth != null". Sem token válido, nada entra
   nem sai. CORS liberado com "*" de propósito: quem protege é o token.

   Configuração esperada (painel da Cloudflare):
     · Binding R2 chamado IMAGENS → bucket liveops-imagens   (etapa 1)
     · Binding D1 chamado DADOS  → banco liveops-dados       (etapa 2)
     · Binding Durable Object SALA → classe Sala deste script (etapa 4)
   Sem um binding, as rotas dele respondem erro e o resto segue
   funcionando — dá para publicar este código antes das amarrações. */

const PROJETO = 'suplelive-8a700';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
// As chaves seguem o formato do imgChave()/push do sistema: letras,
// números, _ e -. Recusar o resto evita chave torta virando lixo.
const CHAVE_OK = /^[A-Za-z0-9_-]{1,200}$/;
// Coleções podem ter níveis (ex.: reg/atividades, logs/_geral)
const COLECAO_OK = /^[A-Za-z0-9_/-]{1,160}$/;
const TAMANHO_MAX = 15 * 1024 * 1024;      // 15 MB por imagem/pacote
const LINHA_MAX = 900 * 1024;              // registro individual no banco
const LOTE_MAX = 400;                      // registros gravados de uma vez no banco
/* O banco aceita no máximo 100 valores por consulta. A busca dos
   registros que já existem passa um valor por chave, então ela vai em
   blocos menores — passar disso derruba a chamada inteira. */
const BLOCO_LEITURA = 90;
const ROBO_MAX_REGISTROS = 20000;          // teto de sanidade por chamada do robô
const AVISO_MAX_LINHAS = 100;              // acima disso, a sala avisa a lista toda

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Max-Age': '86400',
};

function resposta(status, corpo, extra) {
  return new Response(corpo, { status, headers: { ...CORS, ...(extra || {}) } });
}
function respostaJson(status, obj) {
  return resposta(status, JSON.stringify(obj), { 'Content-Type': 'application/json' });
}

// base64url (formato dos tokens JWT) → bytes
function b64urlBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Cache das chaves públicas do Google — giram de tempos em tempos
let _jwks = null;
let _jwksValidade = 0;

async function chavesGoogle(forcar) {
  const agora = Date.now();
  if (!forcar && _jwks && agora < _jwksValidade) return _jwks;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('jwks-indisponivel');
  const dados = await res.json();
  _jwks = dados.keys || [];
  _jwksValidade = agora + 6 * 3600 * 1000;
  return _jwks;
}

// Confere o token do Firebase Auth. Devolve o payload (com .sub = uid)
// ou null. Qualquer defeito cai no null: não existe "meio autenticado".
async function conferirToken(req) {
  const bruto = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return conferirTokenBruto(bruto);
}
async function conferirTokenBruto(bruto) {
  try {
    const partes = String(bruto || '').split('.');
    if (partes.length !== 3) return null;
    const dec = new TextDecoder();
    const cab = JSON.parse(dec.decode(b64urlBytes(partes[0])));
    const corpo = JSON.parse(dec.decode(b64urlBytes(partes[1])));
    if (cab.alg !== 'RS256' || !cab.kid) return null;
    const agora = Math.floor(Date.now() / 1000);
    if (corpo.aud !== PROJETO) return null;
    if (corpo.iss !== 'https://securetoken.google.com/' + PROJETO) return null;
    if (!corpo.sub || (corpo.exp || 0) <= agora) return null;
    let jwk = (await chavesGoogle(false)).find(k => k.kid === cab.kid);
    if (!jwk) jwk = (await chavesGoogle(true)).find(k => k.kid === cab.kid);
    if (!jwk) return null;
    const chave = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const assinou = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', chave,
      b64urlBytes(partes[2]),
      new TextEncoder().encode(partes[0] + '.' + partes[1])
    );
    return assinou ? corpo : null;
  } catch (e) {
    return null;
  }
}

// dataURL → binário com o content-type original; texto puro se não for
function abrirDataUrl(texto) {
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(texto || '');
  if (m) {
    try {
      const bin = atob(m[2]);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return { tipo: m[1], bytes: out };
    } catch (e) { /* base64 torto: cai no texto puro abaixo */ }
  }
  return { tipo: 'text/plain; charset=utf-8', bytes: new TextEncoder().encode(texto || '') };
}

/* ══════════════════════════════════════════════════════════════════
   ETAPA 3 — OS ROBÔS DO n8n
   ══════════════════════════════════════════════════════════════════
   Os fluxos do n8n gravam direto no Firebase. Enquanto for assim, o
   que eles trazem (pedidos da Base, rastreios, canceladas, inbox) não
   chega ao espelho da Cloudflare — e quem já abrir o sistema por aqui
   não veria pedido novo.

   A saída é este worker virar o CARTEIRO: o fluxo entrega aqui, e
   daqui a informação vai para os dois lados — o banco D1 e o Firebase.
   Assim cada fluxo muda uma coisa só (o começo da URL), nada é
   acrescentado, e no dia de desligar o Firebase basta apagar o
   repasse aqui: nenhum fluxo precisa ser tocado de novo.

   As rotas imitam o Firebase de propósito — mesmo caminho, mesmo
   ".json" no fim, mesmo ?shallow=true, mesma resposta. O nó do n8n
   não percebe a troca:

     GET    /robo/reg/pedidosBase.json[?shallow=true]
     GET    /robo/reg/pedidosBase/<chave>.json
     PATCH  /robo/reg/pedidosBase/<chave>.json     corpo: {campos}
     PATCH  /robo/reg/canceladas.json              corpo: {chave:{...}}
     PUT    /robo/inbox/msg/<conv>/<msg>.json      corpo: {campos}
     DELETE /robo/reg/<lista>/<chave>.json

   Quem pode: só quem apresentar o cabeçalho X-LiveOps-Chave com o
   segredo CHAVE_ROBO. É a credencial dos robôs — não dá acesso a
   imagem, a pacote, nem à sala. */
const ROBO_PREFIXOS = ['reg/', 'inbox/', 'atividadesExternas'];
const FB_BASE = 'https://suplelive-8a700-default-rtdb.firebaseio.com';

function b64urlDeTexto(txt) {
  return btoa(unescape(encodeURIComponent(txt))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDeBytes(buf) {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Token do Google para escrever no Firebase, a partir da MESMA conta de
// serviço que o n8n já usa. Vale uma hora; guardado até perto do fim.
let _tokenGoogle = null, _tokenGoogleAte = 0;
async function tokenGoogle(env) {
  if (_tokenGoogle && Date.now() < _tokenGoogleAte) return _tokenGoogle;
  const email = env.FB_SA_EMAIL, pem = env.FB_SA_KEY;
  if (!email || !pem) return null;          // sem credencial: não repassa
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = b64urlDeTexto(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64urlDeTexto(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora, exp: agora + 3600,
  }));
  const limpo = String(pem).replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(limpo);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const chave = await crypto.subtle.importKey(
    'pkcs8', bytes.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const assinatura = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(cabecalho + '.' + corpo)
  );
  const jwt = cabecalho + '.' + corpo + '.' + b64urlDeBytes(assinatura);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt),
  });
  if (!res.ok) throw new Error('token-google-' + res.status);
  const j = await res.json();
  _tokenGoogle = j.access_token;
  _tokenGoogleAte = Date.now() + (((j.expires_in || 3600) - 300) * 1000);
  return _tokenGoogle;
}

// Repassa a gravação ao Firebase, igualzinha à que o fluxo mandaria.
// Falha aqui não derruba a resposta ao robô: o dado já está guardado no
// D1, e o que se perde é a cópia — que o relatório de erro deixa visível.
async function repassarAoFirebase(env, caminho, metodo, corpo) {
  try {
    const tk = await tokenGoogle(env);
    if (!tk) return { status: 'sem-credencial' };
    const res = await fetch(FB_BASE + '/suplelive/' + caminho + '.json', {
      method: metodo,
      headers: { 'Authorization': 'Bearer ' + tk, 'Content-Type': 'application/json' },
      body: corpo,
    });
    let dados = null;
    if (res.ok && metodo === 'POST') { try { dados = await res.json(); } catch (e) {} }
    return { status: res.ok ? 'ok' : ('http-' + res.status), dados };
  } catch (e) {
    return { status: 'erro-' + (e.message || 'desconhecido') };
  }
}

// A tabela nasce sozinha no primeiro uso — ninguém precisa rodar SQL à mão
let _tabelasOk = false;
async function garantirTabelas(env) {
  if (_tabelasOk) return;
  await env.DADOS.prepare(
    'CREATE TABLE IF NOT EXISTS registros (' +
    ' colecao TEXT NOT NULL,' +
    ' chave   TEXT NOT NULL,' +
    ' dados   TEXT NOT NULL,' +
    ' ts      INTEGER NOT NULL,' +
    ' PRIMARY KEY (colecao, chave))'
  ).run();
  _tabelasOk = true;
}

// ── A SALA: o coração do tempo real (Durable Object) ─────────────────
// Uma única sala para o sistema inteiro. Cada navegador logado abre um
// WebSocket para cá; toda gravação que passa pelo worker é anunciada a
// todos; a lista de presentes sai do próprio conjunto de conexões.
// Usa a API de hibernação: a sala dorme sem custo entre mensagens, e os
// dados de cada conexão (uid, nome) sobrevivem no "attachment".
export class Sala {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    try {
      this.ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}')
      );
    } catch (e) { /* versões antigas do runtime */ }
  }

  async fetch(req) {
    const url = new URL(req.url);
    // Aviso interno de mudança, vindo do próprio worker após uma gravação
    if (url.pathname === '/avisar' && req.method === 'POST') {
      const aviso = await req.json().catch(() => null);
      if (aviso) this._transmitir(JSON.stringify({ t: 'mudanca', ...aviso }));
      return new Response('ok');
    }
    // Entrada de um navegador (o worker já conferiu o login antes de encaminhar)
    if ((req.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
      const par = new WebSocketPair();
      this.ctx.acceptWebSocket(par[1]);
      try {
        par[1].serializeAttachment({ uid: req.headers.get('X-Uid') || '', nome: '', ts: Date.now() });
      } catch (e) {}
      this._presenca();
      return new Response(null, { status: 101, webSocket: par[0] });
    }
    return new Response('sala', { status: 200 });
  }

  webSocketMessage(ws, msg) {
    let m = null;
    try { m = JSON.parse(String(msg)); } catch (e) { return; }
    if (m && m.t === 'ola') {
      try {
        const a = ws.deserializeAttachment() || {};
        a.nome = String(m.nome || '').slice(0, 60);
        ws.serializeAttachment(a);
      } catch (e) {}
      this._presenca();
    }
  }
  webSocketClose() { this._presenca(); }
  webSocketError() { this._presenca(); }

  _transmitir(texto) {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(texto); } catch (e) {}
    }
  }
  _presenca() {
    const lista = [];
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const a = ws.deserializeAttachment() || {};
        if (a.uid) lista.push({ uid: a.uid, nome: a.nome || '' });
      } catch (e) {}
    }
    this._transmitir(JSON.stringify({ t: 'presenca', lista }));
  }
}

// Anuncia uma mudança para a sala — melhor esforço, nunca atrasa a resposta
async function avisarSala(env, aviso) {
  try {
    if (!env.SALA) return;
    const id = env.SALA.idFromName('liveops');
    await env.SALA.get(id).fetch('https://sala/avisar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(aviso),
    });
  } catch (e) { /* sala fora do ar não pode derrubar gravação */ }
}

// Junta os campos que chegaram por cima do registro que já existe — é o
// que o PATCH do Firebase faz, e é disso que os fluxos dependem para não
// apagar o resto do pedido a cada atualização.
function _juntarCampos(jsonAtual, novos) {
  let base = {};
  if (jsonAtual) { try { base = JSON.parse(jsonAtual) || {}; } catch (e) { base = {}; } }
  return JSON.stringify(Object.assign(base, novos || {}));
}

async function atenderRobo(req, env, ctx, url) {
  const segredo = req.headers.get('X-LiveOps-Chave') || '';
  if (!env.CHAVE_ROBO) return respostaJson(500, { erro: 'CHAVE_ROBO-ausente' });
  if (segredo !== env.CHAVE_ROBO) return respostaJson(401, { erro: 'chave-invalida' });
  if (!env.DADOS) return respostaJson(500, { erro: 'binding-DADOS-ausente' });
  await garantirTabelas(env);

  const caminho = decodeURIComponent(url.pathname.replace(/^\/robo\//, '')).replace(/\.json$/, '');
  if (!/^[A-Za-z0-9_/-]{1,200}$/.test(caminho)) return respostaJson(400, { erro: 'caminho-invalido' });
  if (!ROBO_PREFIXOS.some(p => caminho.indexOf(p) === 0)) return respostaJson(403, { erro: 'caminho-nao-liberado' });

  const partes = caminho.split('/').filter(Boolean);
  const ehColecao = partes.length <= 2;            // reg/pedidosBase, inbox/conv
  const colecao = ehColecao ? caminho : partes.slice(0, -1).join('/');
  const chave = ehColecao ? '' : partes[partes.length - 1];
  if (chave && !CHAVE_OK.test(chave)) return respostaJson(400, { erro: 'chave-invalida-no-caminho' });

  // ── Leitura: mesma cara das respostas do Firebase ──
  if (req.method === 'GET') {
    if (ehColecao) {
      const rs = await env.DADOS.prepare(
        'SELECT chave, dados FROM registros WHERE colecao = ?1 ORDER BY chave'
      ).bind(colecao).all();
      const linhas = rs.results || [];
      const raso = url.searchParams.get('shallow') === 'true';
      const corpo = '{' + linhas.map(l =>
        JSON.stringify(l.chave) + ':' + (raso ? 'true' : l.dados)
      ).join(',') + '}';
      return resposta(200, corpo, { 'Content-Type': 'application/json' });
    }
    const l = await env.DADOS.prepare(
      'SELECT dados FROM registros WHERE colecao = ?1 AND chave = ?2'
    ).bind(colecao, chave).first();
    return resposta(200, l ? l.dados : 'null', { 'Content-Type': 'application/json' });
  }

  if (['PATCH', 'PUT', 'POST', 'DELETE'].indexOf(req.method) < 0) {
    return respostaJson(405, { erro: 'metodo-nao-suportado' });
  }
  /* Substituir ou apagar uma lista inteira de uma vez não é coisa que
     robô faça por bem — nenhum fluxo precisa disso, e um engano aqui
     levaria a operação junto. Na lista só passam PATCH (vários
     registros) e POST (um registro novo, com chave inventada). */
  if (ehColecao && ['PATCH', 'POST'].indexOf(req.method) < 0) {
    return respostaJson(403, { erro: 'lista-inteira-nao-pode' });
  }
  if (!ehColecao && req.method === 'POST') {
    return respostaJson(400, { erro: 'post-e-so-na-lista' });
  }

  const texto = req.method === 'DELETE' ? '' : await req.text();
  let corpo = null;
  if (texto) {
    try { corpo = JSON.parse(texto); }
    catch (e) { return respostaJson(400, { erro: 'json-invalido' }); }
  }
  if (texto && texto.length > TAMANHO_MAX) return respostaJson(413, { erro: 'grande-demais' });

  const agora = Date.now();

  /* POST cria um registro com chave inventada. Quem inventa é o Firebase,
     e o repasse vai ANTES justamente por isso: assim os dois lados ficam
     com a MESMA chave, e a fila que o sistema consome não vira duas. */
  if (req.method === 'POST') {
    const json = JSON.stringify(corpo === null ? {} : corpo);
    if (json.length > LINHA_MAX) return respostaJson(413, { erro: 'registro-grande-demais' });
    const r = await repassarAoFirebase(env, caminho, 'POST', texto);
    const nova = (r.dados && r.dados.name) ? r.dados.name : ('cf' + Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 8));
    if (!CHAVE_OK.test(nova)) return respostaJson(500, { erro: 'chave-gerada-invalida' });
    await env.DADOS.prepare(
      'INSERT INTO registros (colecao, chave, dados, ts) VALUES (?1, ?2, ?3, ?4) ' +
      'ON CONFLICT(colecao, chave) DO UPDATE SET dados = ?3, ts = ?4'
    ).bind(colecao, nova, json, agora).run();
    ctx.waitUntil(avisarSala(env, { linhas: [{ colecao, chave: nova }] }));
    // O Firebase responde {"name":"<chave>"} — os fluxos contam com isso
    return respostaJson(200, { name: nova, firebase: r.status });
  }
  const insere = env.DADOS.prepare(
    'INSERT INTO registros (colecao, chave, dados, ts) VALUES (?1, ?2, ?3, ?4) ' +
    'ON CONFLICT(colecao, chave) DO UPDATE SET dados = ?3, ts = ?4'
  );
  const stmts = [];
  const mudancas = [];
  let gravadasAgora = 0;

  if (req.method === 'DELETE') {
    stmts.push(env.DADOS.prepare('DELETE FROM registros WHERE colecao = ?1 AND chave = ?2').bind(colecao, chave));
    mudancas.push({ colecao, chave, apagada: true });

  } else if (ehColecao) {
    /* PATCH na lista: o corpo traz vários registros de uma vez — o
       catálogo da Base manda uma página inteira. Quem se adapta é o
       worker: em vez de recusar o que passar do tamanho do lote, ele
       divide em blocos e grava um atrás do outro. Recusar obrigaria a
       mexer na lógica do fluxo, que é justamente o que esta migração
       promete não fazer. */
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
      return respostaJson(400, { erro: 'esperava-um-objeto-de-registros' });
    }
    const chaves = Object.keys(corpo).filter(k => CHAVE_OK.test(k));
    if (!chaves.length) return respostaJson(200, { ok: true, gravadas: 0 });
    if (chaves.length > ROBO_MAX_REGISTROS) {
      return respostaJson(413, { erro: 'registros-demais', limite: ROBO_MAX_REGISTROS });
    }
    // Só os registros que estão chegando são lidos para a junção — puxar
    // a lista inteira a cada página não caberia num catálogo grande.
    const existentes = {};
    for (let i = 0; i < chaves.length; i += BLOCO_LEITURA) {
      const bloco = chaves.slice(i, i + BLOCO_LEITURA);
      const marcas = bloco.map((_, j) => '?' + (j + 2)).join(',');
      const rs = await env.DADOS.prepare(
        'SELECT chave, dados FROM registros WHERE colecao = ?1 AND chave IN (' + marcas + ')'
      ).bind(colecao, ...bloco).all();
      (rs.results || []).forEach(l => { existentes[l.chave] = l.dados; });
    }
    for (let i = 0; i < chaves.length; i += LOTE_MAX) {
      const lote = [];
      for (const k of chaves.slice(i, i + LOTE_MAX)) {
        const json = _juntarCampos(existentes[k], corpo[k]);
        if (json.length > LINHA_MAX) continue;
        lote.push(insere.bind(colecao, k, json, agora));
        mudancas.push({ colecao, chave: k });
      }
      if (lote.length) { await env.DADOS.batch(lote); gravadasAgora += lote.length; }
    }

  } else {
    const atual = await env.DADOS.prepare(
      'SELECT dados FROM registros WHERE colecao = ?1 AND chave = ?2'
    ).bind(colecao, chave).first();
    // PATCH junta com o que já existe; PUT põe no lugar
    const json = req.method === 'PATCH'
      ? _juntarCampos(atual && atual.dados, corpo)
      : JSON.stringify(corpo === null ? {} : corpo);
    if (json.length > LINHA_MAX) return respostaJson(413, { erro: 'registro-grande-demais' });
    stmts.push(insere.bind(colecao, chave, json, agora));
    mudancas.push({ colecao, chave });
  }

  if (stmts.length) { await env.DADOS.batch(stmts); gravadasAgora += stmts.length; }

  /* Quem já abriu o sistema pela Cloudflare vê a novidade na hora. Numa
     carga grande, porém, mandar uma linha por registro faria cada tela
     buscar milhares de registros um a um: aí o aviso é de lista inteira,
     e quem recebe recarrega a lista de uma vez só. */
  if (mudancas.length > AVISO_MAX_LINHAS) {
    const listas = [];
    mudancas.forEach(m => { if (listas.indexOf(m.colecao) < 0) listas.push(m.colecao); });
    ctx.waitUntil(avisarSala(env, { listas }));
  } else if (mudancas.length) {
    ctx.waitUntil(avisarSala(env, { linhas: mudancas }));
  }

  /* O repasse é esperado de propósito: enquanto o Firebase for a fonte de
     quem ainda não virou, uma falha aqui precisa aparecer na execução do
     fluxo, e não sumir num log que ninguém lê. */
  const r = await repassarAoFirebase(env, caminho, req.method, texto || undefined);
  return respostaJson(200, { ok: true, gravadas: gravadasAgora, firebase: r.status });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return resposta(204, null);
    if (url.pathname === '/saude') return resposta(200, 'ok', { 'Content-Type': 'text/plain' });

    /* Os robôs entram por outra porta: chave própria, sem login de pessoa.
       Um erro aqui não pode virar "exceção não tratada": o n8n mostraria
       só que "o serviço não conseguiu processar", sem dizer o quê. O
       motivo volta escrito, na execução do fluxo, onde alguém vai ler. */
    if (url.pathname.indexOf('/robo/') === 0) {
      return atenderRobo(req, env, ctx, url).catch(e =>
        respostaJson(500, { erro: 'falha-no-worker', detalhe: (e && e.message) || String(e) })
      );
    }

    if (!env.IMAGENS) return respostaJson(500, { erro: 'binding-IMAGENS-ausente' });

    // ── TEMPO REAL (etapa 4): entrada na sala ──────────────────
    // Fica antes da porta comum porque o token vem na URL, não no
    // cabeçalho — WebSocket de navegador não envia Authorization.
    if (url.pathname === '/rt') {
      if (!env.SALA) return respostaJson(500, { erro: 'binding-SALA-ausente' });
      if ((req.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
        return respostaJson(400, { erro: 'esperava-websocket' });
      }
      const quemRt = await conferirTokenBruto(url.searchParams.get('token') || '');
      if (!quemRt) return respostaJson(401, { erro: 'sem-login' });
      const cab = new Headers(req.headers);
      cab.set('X-Uid', quemRt.sub);
      const id = env.SALA.idFromName('liveops');
      return env.SALA.get(id).fetch(new Request('https://sala/ws', { method: 'GET', headers: cab }));
    }

    const quem = await conferirToken(req);
    if (!quem) return respostaJson(401, { erro: 'sem-login' });

    // ── DADOS (etapa 2) ──────────────────────────────────────────
    if (url.pathname.startsWith('/dados/')) {
      // Pacotes inteiros (ex.: o estado do sistema) vivem no R2, que não
      // tem limite apertado de tamanho — o banco fica para os registros.
      const mp = /^\/dados\/pacote\/([A-Za-z0-9_-]{1,60})$/.exec(url.pathname);
      if (mp) {
        const nome = mp[1];
        if (req.method === 'PUT') {
          const texto = await req.text();
          if (!texto) return respostaJson(400, { erro: 'corpo-vazio' });
          if (texto.length > TAMANHO_MAX) return respostaJson(413, { erro: 'grande-demais' });
          await env.IMAGENS.put('_dados/' + nome + '.json', texto, {
            httpMetadata: { contentType: 'application/json' },
            customMetadata: { por: quem.sub, ts: String(Date.now()) },
          });
          ctx.waitUntil(avisarSala(env, { pacote: nome }));
          return respostaJson(200, { ok: true });
        }
        if (req.method === 'GET') {
          const obj = await env.IMAGENS.get('_dados/' + nome + '.json');
          if (!obj) return respostaJson(404, { erro: 'nao-achado' });
          return new Response(obj.body, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
        }
        return respostaJson(405, { erro: 'metodo-nao-suportado' });
      }

      if (!env.DADOS) return respostaJson(500, { erro: 'binding-DADOS-ausente' });
      await garantirTabelas(env);

      // ── Leitura (etapa 4): um registro, ou uma página da coleção ──
      // Os dados já estão guardados como JSON; devolvê-los "crus" evita
      // codificar duas vezes.
      if (url.pathname === '/dados/registro' && req.method === 'GET') {
        const colecao = url.searchParams.get('colecao') || '';
        const chave = url.searchParams.get('chave') || '';
        if (!COLECAO_OK.test(colecao) || !CHAVE_OK.test(chave)) {
          return respostaJson(400, { erro: 'parametros' });
        }
        const linha = await env.DADOS.prepare(
          'SELECT dados, ts FROM registros WHERE colecao = ?1 AND chave = ?2'
        ).bind(colecao, chave).first();
        if (!linha) return respostaJson(404, { erro: 'nao-achado' });
        return resposta(200, '{"ts":' + (linha.ts || 0) + ',"dados":' + linha.dados + '}',
          { 'Content-Type': 'application/json' });
      }
      if (url.pathname === '/dados/colecao' && req.method === 'GET') {
        const nome = url.searchParams.get('nome') || '';
        if (!COLECAO_OK.test(nome)) return respostaJson(400, { erro: 'parametros' });
        const depois = url.searchParams.get('depois') || '';
        let limite = parseInt(url.searchParams.get('limite') || '500', 10);
        if (!(limite > 0 && limite <= 1000)) limite = 500;
        const rs = await env.DADOS.prepare(
          'SELECT chave, dados, ts FROM registros WHERE colecao = ?1 AND chave > ?2 ORDER BY chave LIMIT ?3'
        ).bind(nome, depois, limite).all();
        const linhas = rs.results || [];
        const corpo = '{"linhas":[' + linhas.map(l =>
          '{"chave":' + JSON.stringify(l.chave) + ',"ts":' + (l.ts || 0) + ',"dados":' + l.dados + '}'
        ).join(',') + '],"proxima":' +
          (linhas.length === limite ? JSON.stringify(linhas[linhas.length - 1].chave) : 'null') + '}';
        return resposta(200, corpo, { 'Content-Type': 'application/json' });
      }

      if (url.pathname === '/dados/lote' && req.method === 'POST') {
        const corpo = await req.json().catch(() => null);
        const linhas = corpo && Array.isArray(corpo.linhas) ? corpo.linhas : null;
        if (!linhas || !linhas.length) return respostaJson(400, { erro: 'sem-linhas' });
        if (linhas.length > LOTE_MAX) return respostaJson(413, { erro: 'lote-grande-demais' });
        const insere = env.DADOS.prepare(
          'INSERT INTO registros (colecao, chave, dados, ts) VALUES (?1, ?2, ?3, ?4) ' +
          'ON CONFLICT(colecao, chave) DO UPDATE SET dados = ?3, ts = ?4'
        );
        const apaga = env.DADOS.prepare('DELETE FROM registros WHERE colecao = ?1 AND chave = ?2');
        const stmts = [];
        const mudancas = [];
        let puladas = 0;
        const agora = Date.now();
        for (const l of linhas) {
          const colecao = l && l.colecao, chave = l && l.chave;
          if (typeof colecao !== 'string' || typeof chave !== 'string'
            || !COLECAO_OK.test(colecao) || !CHAVE_OK.test(chave)) { puladas++; continue; }
          if (l.dados === null || l.dados === undefined) {
            stmts.push(apaga.bind(colecao, chave));
            mudancas.push({ colecao, chave, apagada: true });
          } else {
            let json;
            try { json = typeof l.dados === 'string' ? l.dados : JSON.stringify(l.dados); }
            catch (e) { puladas++; continue; }
            if (!json || json.length > LINHA_MAX) { puladas++; continue; }
            stmts.push(insere.bind(colecao, chave, json, agora));
            mudancas.push({ colecao, chave });
          }
        }
        if (stmts.length) {
          await env.DADOS.batch(stmts);
          ctx.waitUntil(avisarSala(env, { linhas: mudancas }));
        }
        return respostaJson(200, { ok: true, gravadas: stmts.length, puladas });
      }

      if (url.pathname === '/dados/resumo' && req.method === 'GET') {
        const regs = await env.DADOS.prepare(
          'SELECT colecao, COUNT(*) AS registros FROM registros GROUP BY colecao ORDER BY colecao'
        ).all();
        let pacotes = [];
        try {
          const lp = await env.IMAGENS.list({ prefix: '_dados/' });
          pacotes = lp.objects.map(o => ({
            nome: o.key.replace(/^_dados\//, '').replace(/\.json$/, ''),
            bytes: o.size,
          }));
        } catch (e) { /* sem pacotes ainda */ }
        return respostaJson(200, { colecoes: (regs.results || []), pacotes });
      }

      return respostaJson(404, { erro: 'rota-desconhecida' });
    }

    // ── IMAGENS (etapa 1) ────────────────────────────────────────
    if (url.pathname === '/lista' && req.method === 'GET') {
      const chaves = [];
      let cursor;
      do {
        const pag = await env.IMAGENS.list({ cursor, limit: 1000 });
        for (const o of pag.objects) {
          if (o.key.startsWith('_dados/')) continue; // pacotes não são imagens
          chaves.push(o.key);
        }
        cursor = pag.truncated ? pag.cursor : null;
      } while (cursor && chaves.length < 50000);
      return respostaJson(200, chaves);
    }

    const m = /^\/img\/([^/]+)$/.exec(url.pathname);
    if (!m) return respostaJson(404, { erro: 'rota-desconhecida' });
    const chave = decodeURIComponent(m[1]);
    if (!CHAVE_OK.test(chave)) return respostaJson(400, { erro: 'chave-invalida' });

    if (req.method === 'GET') {
      const obj = await env.IMAGENS.get(chave);
      if (!obj) return respostaJson(404, { erro: 'nao-achada' });
      return new Response(obj.body, {
        status: 200,
        headers: {
          ...CORS,
          'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream',
          'Cache-Control': 'private, max-age=86400',
        },
      });
    }

    if (req.method === 'PUT') {
      const texto = await req.text();
      if (!texto) return respostaJson(400, { erro: 'corpo-vazio' });
      if (texto.length > TAMANHO_MAX) return respostaJson(413, { erro: 'grande-demais' });
      const { tipo, bytes } = abrirDataUrl(texto);
      await env.IMAGENS.put(chave, bytes, {
        httpMetadata: { contentType: tipo },
        customMetadata: { por: quem.sub, ts: String(Date.now()) },
      });
      ctx.waitUntil(avisarSala(env, { img: chave }));
      return respostaJson(200, { ok: true });
    }

    if (req.method === 'DELETE') {
      await env.IMAGENS.delete(chave);
      ctx.waitUntil(avisarSala(env, { img: chave, apagada: true }));
      return respostaJson(200, { ok: true });
    }

    return respostaJson(405, { erro: 'metodo-nao-suportado' });
  },
};
