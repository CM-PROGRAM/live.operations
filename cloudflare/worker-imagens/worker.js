/* LiveOps — Worker da migração Cloudflare (R2 + D1)
   ==================================================
   Etapa 1 — IMAGENS: guarda e serve as imagens originais no R2.
   Etapa 2 — DADOS:   recebe o espelho de tudo que o sistema grava no
                      Firebase — registros no banco D1, pacote de estado
                      no R2 — para toda a informação viver também aqui.

   IMPORTANTE: nada aqui substitui o Firebase — é cópia em paralelo. O
   sistema continua gravando no Firebase como sempre; este worker recebe
   uma segunda via. Se ele cair ou nem existir, nada muda para quem usa.

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
     GET    /dados/resumo           → contagem por coleção + pacotes guardados

   Segurança: o MESMO login do sistema. O navegador manda o token do
   Firebase Auth (Authorization: Bearer ...) e o worker confere a
   assinatura contra as chaves públicas do Google — o equivalente às
   regras do banco exigirem "auth != null". Sem token válido, nada entra
   nem sai. CORS liberado com "*" de propósito: quem protege é o token.

   Configuração esperada (painel da Cloudflare):
     · Binding R2 chamado IMAGENS → bucket liveops-imagens  (etapa 1)
     · Binding D1 chamado DADOS  → banco liveops-dados      (etapa 2)
   Sem o binding DADOS, as rotas /dados respondem erro e o resto segue
   funcionando — dá para publicar este código antes de criar o banco. */

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
  try {
    const bruto = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const partes = bruto.split('.');
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return resposta(204, null);
    if (url.pathname === '/saude') return resposta(200, 'ok', { 'Content-Type': 'text/plain' });

    if (!env.IMAGENS) return respostaJson(500, { erro: 'binding-IMAGENS-ausente' });

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
        let puladas = 0;
        const agora = Date.now();
        for (const l of linhas) {
          const colecao = l && l.colecao, chave = l && l.chave;
          if (typeof colecao !== 'string' || typeof chave !== 'string'
            || !COLECAO_OK.test(colecao) || !CHAVE_OK.test(chave)) { puladas++; continue; }
          if (l.dados === null || l.dados === undefined) {
            stmts.push(apaga.bind(colecao, chave));
          } else {
            let json;
            try { json = typeof l.dados === 'string' ? l.dados : JSON.stringify(l.dados); }
            catch (e) { puladas++; continue; }
            if (!json || json.length > LINHA_MAX) { puladas++; continue; }
            stmts.push(insere.bind(colecao, chave, json, agora));
          }
        }
        if (stmts.length) await env.DADOS.batch(stmts);
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
      return respostaJson(200, { ok: true });
    }

    if (req.method === 'DELETE') {
      await env.IMAGENS.delete(chave);
      return respostaJson(200, { ok: true });
    }

    return respostaJson(405, { erro: 'metodo-nao-suportado' });
  },
};
