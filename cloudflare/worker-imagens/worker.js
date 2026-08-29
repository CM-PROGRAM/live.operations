/* LiveOps — Worker de imagens (Cloudflare R2)
   ============================================
   Etapa 1 da migração para a Cloudflare: guardar e servir as imagens
   originais do sistema a partir do R2, onde o armazenamento custa
   centavos e o download é grátis.

   IMPORTANTE: este worker NÃO substitui o Firebase — ele é uma cópia em
   paralelo. O sistema continua gravando as imagens no Firebase como
   sempre fez; este worker só recebe uma segunda via e passa a ser o
   primeiro lugar onde o sistema tenta ler. Se ele cair ou nem existir,
   o Firebase responde e nada muda para quem usa.

   Rotas (todas exigem o login do sistema, exceto /saude):
     GET    /saude        → "ok" — só para testar se a publicação deu certo
     GET    /img/<chave>  → devolve a imagem (binário, content-type original)
     PUT    /img/<chave>  → grava (o corpo é o dataURL que o sistema já usa)
     DELETE /img/<chave>  → remove
     GET    /lista        → todas as chaves guardadas (para backup/export)

   Segurança: o MESMO login do sistema. O navegador manda o token do
   Firebase Auth no cabeçalho (Authorization: Bearer ...) e o worker
   confere a assinatura contra as chaves públicas do Google — o
   equivalente às regras do banco exigirem "auth != null". Sem token
   válido, nada entra e nada sai. CORS liberado com "*" de propósito:
   quem protege é o token, não a origem — e assim o worker funciona no
   GitHub Pages, num domínio próprio futuro e até aberto via file://.

   Configuração esperada (feita no painel da Cloudflare, ver
   docs/cloudflare-imagens.md):
     · Binding R2 chamado IMAGENS apontando para o bucket de imagens. */

const PROJETO = 'suplelive-8a700';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
// As chaves seguem o formato do imgChave() do sistema: letras, números,
// _ e -. Recusar o resto evita chave torta virando lixo no bucket.
const CHAVE_OK = /^[A-Za-z0-9_-]{1,200}$/;
const TAMANHO_MAX = 15 * 1024 * 1024; // 15 MB por imagem é folga

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS',
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

// Cache das chaves públicas do Google — elas giram de tempos em tempos,
// então valem por 6 horas e são recarregadas se aparecer um kid novo.
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
// ou null. Qualquer defeito — formato, assinatura, projeto errado,
// vencido — cai no null: aqui não existe "meio autenticado".
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

// O sistema manda a imagem como dataURL (data:image/jpeg;base64,...).
// Aqui ela vira binário de verdade, com o content-type original — assim
// o GET devolve uma imagem que o navegador entende, e o bucket não
// carrega os 33% de gordura do base64. Se o corpo não for um dataURL,
// guarda como texto mesmo, para nunca perder nada.
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return resposta(204, null);
    if (url.pathname === '/saude') return resposta(200, 'ok', { 'Content-Type': 'text/plain' });

    if (!env.IMAGENS) return respostaJson(500, { erro: 'binding-IMAGENS-ausente' });

    const quem = await conferirToken(req);
    if (!quem) return respostaJson(401, { erro: 'sem-login' });

    if (url.pathname === '/lista' && req.method === 'GET') {
      const chaves = [];
      let cursor;
      do {
        const pag = await env.IMAGENS.list({ cursor, limit: 1000 });
        for (const o of pag.objects) chaves.push(o.key);
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
