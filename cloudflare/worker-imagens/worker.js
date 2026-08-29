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
const LOTE_MAX = 400;                      // linhas por chamada

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

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return resposta(204, null);
    if (url.pathname === '/saude') return resposta(200, 'ok', { 'Content-Type': 'text/plain' });

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
