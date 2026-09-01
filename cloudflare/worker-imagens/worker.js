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
     /api/v1/…                      → API REST para integrações de fora
                                      (documentada em docs/api-rest.md e no
                                      bloco "API REST DO LIVEOPS" abaixo)

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

/* Muda a cada versão colada no painel. O /saude devolve este número, e é
   assim que se sabe, em dois segundos, se o que está no ar é o código
   novo ou o antigo — dúvida que já custou uma hora de caça a fantasma. */
const VERSAO_WORKER = 'v20';

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
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-LiveOps-Chave',
  'Access-Control-Max-Age': '86400',
};

/* As origens que de fato abrem o sistema. Quem chama de fora — n8n,
   parceiro com chave — nao passa por CORS: navegador nenhum esta
   envolvido ali. O '*' que estava aqui deixava qualquer pagina da
   internet ler a resposta com um token que ela ja tivesse.

   A troca e feita na SAIDA, num lugar so (_comCors), e nao numa variavel
   global lida por resposta(): o isolate atende varias requisicoes ao
   mesmo tempo, e uma global viraria a origem de um pedido na resposta de
   outro. */
const ORIGENS_OK = new Set([
  'https://cm-program.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);
const ORIGEM_PADRAO = 'https://cm-program.github.io';
function _comCors(req, resp) {
  /* A SALA NAO PODE SER REEMBRULHADA — v19
     ═══════════════════════════════════════════════════════════════
     A resposta de um WebSocket e um 101, e o par de sockets viaja no
     campo `webSocket` da Response. `new Response(...)` nao carrega esse
     campo, e o construtor nem aceita status 101: reconstruir aqui
     destruia o handshake.

     Foi o que a v16 passou a fazer com TODAS as respostas, inclusive a
     do /rt. Desde entao a sala nunca mais conectou — e o sintoma
     aparecia longe da causa: "tempo real reconectando" no painel, e a
     leitura caindo para o Firebase depois de quatro tentativas.

     CORS tambem nao se aplica: o handshake de WebSocket nao passa por
     preflight, e o navegador nao le esses cabecalhos nele. */
  if (resp.status === 101 || resp.webSocket) return resp;
  const o = req.headers.get('Origin') || '';
  const permitida = ORIGENS_OK.has(o) ? o : ORIGEM_PADRAO;
  const h = new Headers(resp.headers);
  h.set('Access-Control-Allow-Origin', permitida);
  /* Sem o Vary, a cache pode servir a uma origem o cabecalho calculado
     para outra — e o fechamento vira teatro. */
  h.set('Vary', 'Origin');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

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

/* O cache das chaves publicas do Google saiu na v18, junto com o resto do
   Firebase: nao se busca mais chave de fora para decidir quem entra. */

// Confere o cracha da sessao. Devolve o payload (com .chave = quem)
// ou null. Qualquer defeito cai no null: não existe "meio autenticado".
async function conferirToken(req, env) {
  const bruto = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return conferirTokenBruto(bruto, env);
}
async function conferirTokenBruto(bruto, env) {
  /* v18 — o projeto do Firebase foi EXCLUIDO em 31/08/2026, e com ele a
     unica coisa capaz de emitir o outro cracha que esta porta aceitava.
     O caminho saiu inteiro em vez de ficar de enfeite: enquanto existisse,
     era uma dependencia externa viva (chaves publicas do Google, busca de
     JWKS, cache) num portao de autenticacao — para validar tokens de um
     projeto que nao existe mais.
     Fica UM cracha, o que este worker mesmo emite. */
  if (!env) return null;
  return await _conferirTokenProprio(env, bruto);
}

/* ══════════════════════════════════════════════════════════════════
   TER TOKEN DO PROJETO NUNCA FOI O MESMO QUE TRABALHAR AQUI
   ══════════════════════════════════════════════════════════════════
   O achado 1 da auditoria, e vale guardado porque explica a forma que o
   codigo tem hoje: com o apiKey publico na pagina, qualquer pessoa criava
   conta contra o projeto e recebia um token que passava em
   conferirToken() — assinatura boa, aud certo, exp valido. Faltava
   perguntar se aquele uid trabalhava aqui, e a v16 passou a perguntar.

   Na v18 a pergunta perdeu o objeto: o projeto foi excluido, nao existe
   mais token de fora para conferir, e a porta aceita um cracha so — o que
   este worker emite, que nasce de uma senha conferida no proprio cofre.
   A funcao ficou como o portao unico. */
async function _filtrarAutorizado(env, quem) {
  if (!quem) return null;
  /* Sobrou so o cracha proprio, e ele ja nasce de uma senha conferida
     contra o cofre. A consulta a lista `autorizados` servia ao cracha do
     Firebase; sem ele, quem semeia so consegue semear a PROPRIA chave —
     e isso quem confere e o /auth/semear, comparando cracha e chave. */
  return quem.iss === 'liveops' ? quem : null;
}
async function conferirTokenAutorizado(req, env) {
  return _filtrarAutorizado(env, await conferirToken(req, env));
}
async function conferirTokenBrutoAutorizado(bruto, env) {
  return _filtrarAutorizado(env, await conferirTokenBruto(bruto, env));
}

/* Quem e o dono da casa. Mesma pergunta que a API v1 ja fazia; agora as
   rotas /dados/ tambem sabem responder. */
function _ehMestre(env, quem) {
  if (!quem) return false;
  return !!((env.MASTER_CHAVE && quem.iss === 'liveops' && String(quem.chave || '') === env.MASTER_CHAVE) ||
            (env.MASTER_UID && String(quem.sub || '') === env.MASTER_UID));
}

/* Estas colecoes decidem QUEM E QUEM. Gravar nelas pela porta comum
   seria escolher a propria permissao — e era o degrau que transformava
   uma conta qualquer em master. So o master e o robo (que entra por
   /robo/, com portao proprio) passam. */
const COLECOES_PROTEGIDAS = new Set(['autorizados', 'usuarios', 'users', 'permissoes', 'senhas', 'forceLogout']);

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

function b64urlDeTexto(txt) {
  return btoa(unescape(encodeURIComponent(txt))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDeBytes(buf) {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* v18 — O REPASSE MORREU COM O PROJETO
   ══════════════════════════════════════════════════════════════════
   Aqui viviam a conta de servico (tokenGoogle, com FB_SA_EMAIL e
   FB_SA_KEY) e a copia de cada gravacao para o Realtime Database. O
   projeto do Firebase foi EXCLUIDO em 31/08/2026: nao ha banco para
   copiar, nem credencial que sirva.

   A funcao ficou, e devolve sempre o mesmo. Cinco lugares gravam e
   perguntam "como foi a copia?" — trocar isso agora seria mexer em cinco
   caminhos de gravacao para nao mudar nada. Ela sai no dia em que a
   pergunta sair junto.

   No painel: os secrets FB_SA_EMAIL e FB_SA_KEY podem ser apagados, e a
   variavel FB_REPASSE tambem — nao ha mais o que ligar ou desligar. */
async function repassarAoFirebase(env, caminho, metodo, corpo) {
  return { status: 'firebase-excluido' };
}

/* ══════════════════════════════════════════════════════════════════
   ETAPA 5 — O LOGIN PRÓPRIO
   ══════════════════════════════════════════════════════════════════
   Até aqui quem dizia "esta pessoa é quem diz ser" era o Firebase Auth,
   e é por isso que ele não podia ser desligado: sem ele, o worker
   recusaria todo mundo — inclusive as fotos e o espelho.

   Agora o worker sabe fazer isso sozinho:

     POST /auth/semear   (com token do Firebase)  → guarda a senha desta
       pessoa aqui, com hash. É a ponte: no primeiro login de cada um,
       feito pelo Firebase como sempre, a senha passa a existir também
       deste lado. Ninguém precisa redefinir nada. Semear é sempre a
       PRÓPRIA senha: o crachá diz de quem é, a conta precisa estar na
       lista de aprovados, e o primeiro dono de um nome fica com ele.
     POST /auth/entrar   {chave, senha}           → confere e devolve um
       token próprio, válido por 12 horas.

   A senha nunca é guardada: fica só o resultado de 150 mil rodadas de
   PBKDF2 sobre ela, com um sal por pessoa. Conferir é refazer a conta e
   comparar — de quem tem o banco na mão, não se tira a senha de volta.

   Durante a transição o worker aceita OS DOIS tokens: o do Firebase e o
   dele. Quando todo mundo tiver entrado uma vez, o do Firebase pode
   deixar de ser aceito — e aí o Firebase inteiro se desliga. */
const SESSAO_HORAS = 12;

function _segredoSessao(env) {
  return env.SEGREDO_SESSAO || env.CHAVE_ROBO || '';
}

/* Quantas voltas de PBKDF2 cabem NESTE worker nao da para saber daqui: o
   limite muda com o plano e com o que o runtime aceita. Entao a resposta
   e MEDIDA, uma vez,
   descendo a escada ate uma volta que o runtime aceite; e o numero que
   venceu fica gravado junto com a senha, porque conferir depois exige
   refazer exatamente a mesma conta. Subir o numero um dia nao invalida
   nada: cada linha lembra o seu. */
const PBKDF2_ESCADA = [150000, 100000, 60000, 30000, 15000, 8000];
let _voltasBoas = 0;

// PBKDF2: transformar a senha em algo de onde ela não volta
async function _hashSenha(senha, sal, voltas) {
  const bytesSal = b64urlBytes(sal);
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(senha)), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: bytesSal, iterations: voltas, hash: 'SHA-256' }, base, 256
  );
  return b64urlDeBytes(bits);
}

/* Devolve { voltas, hash } usando a volta mais alta que este runtime
   aceitar. O motivo de cada recusa volta junto na excecao final: falhar
   sem dizer por que foi exatamente o que custou esta manha. */
async function _hashSenhaNoMaximo(senha, sal) {
  if (_voltasBoas) return { voltas: _voltasBoas, hash: await _hashSenha(senha, sal, _voltasBoas) };
  const recusas = [];
  for (const v of PBKDF2_ESCADA) {
    try {
      const hash = await _hashSenha(senha, sal, v);
      _voltasBoas = v;
      return { voltas: v, hash };
    } catch (e) {
      recusas.push(v + ': ' + ((e && (e.name || '')) + ' ' + ((e && e.message) || '')).trim());
    }
  }
  throw new Error('nenhuma volta de PBKDF2 passou — ' + recusas.join(' | '));
}

/* Comparação que leva o mesmo tempo com qualquer entrada — comparar com
   === vazaria, pelo relógio, quantos caracteres iniciais estavam certos. */
function _iguaisNoTempo(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (x.length !== y.length) return false;
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return dif === 0;
}

async function _assinarHmac(env, texto) {
  const chave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(_segredoSessao(env)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const bits = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(texto));
  return b64urlDeBytes(bits);
}

async function _emitirToken(env, chaveUsuario) {
  const agora = Math.floor(Date.now() / 1000);
  const cab = b64urlDeTexto(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = b64urlDeTexto(JSON.stringify({
    iss: 'liveops', sub: 'lo_' + chaveUsuario, chave: chaveUsuario,
    iat: agora, exp: agora + SESSAO_HORAS * 3600,
  }));
  const assinatura = await _assinarHmac(env, cab + '.' + corpo);
  return { token: cab + '.' + corpo + '.' + assinatura, exp: (agora + SESSAO_HORAS * 3600) * 1000 };
}

// Confere um token emitido por este worker. Devolve o payload ou null.
async function _conferirTokenProprio(env, bruto) {
  try {
    const partes = String(bruto || '').split('.');
    if (partes.length !== 3) return null;
    const cab = JSON.parse(new TextDecoder().decode(b64urlBytes(partes[0])));
    if (cab.alg !== 'HS256') return null;
    if (!_segredoSessao(env)) return null;
    const esperada = await _assinarHmac(env, partes[0] + '.' + partes[1]);
    if (!_iguaisNoTempo(esperada, partes[2])) return null;
    const corpo = JSON.parse(new TextDecoder().decode(b64urlBytes(partes[1])));
    if (corpo.iss !== 'liveops' || !corpo.sub) return null;
    if ((corpo.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return corpo;
  } catch (e) {
    return null;
  }
}

/* A v11 acrescentou colunas a uma tabela que ja existia, por ALTER TABLE,
   com o erro engolido por um catch — "a coluna ja estava la" era o caso
   esperado. Quando o ALTER nao pegou, o catch apagou o motivo e o SELECT
   seguinte estourava como "falha-no-worker", sem dizer nada.

   Nao ha remendo para isso que valha a pena: a tabela nasce COMPLETA,
   com outro nome, e a antiga vai embora. Sem ALTER, sem forma herdada,
   sem caminho onde a diferenca entre "ja estava la" e "nao deu" fique
   invisivel. Custa a cada pessoa entrar mais uma vez — e so. */
const TABELA_SENHAS = 'senhas';
let _tabelaUsuariosOk = false;
async function garantirTabelaUsuarios(env) {
  if (_tabelaUsuariosOk) return;
  await env.DADOS.prepare(
    'CREATE TABLE IF NOT EXISTS ' + TABELA_SENHAS + ' (' +
    ' chave TEXT PRIMARY KEY, sal TEXT NOT NULL, hash TEXT NOT NULL,' +
    ' uid TEXT, iter INTEGER, ts INTEGER NOT NULL)'
  ).run();

  /* Conferir em vez de supor. Se um dia faltar coluna, a mensagem diz
     QUAL — em vez de sair um "falha-no-worker" no primeiro SELECT. */
  const info = await env.DADOS.prepare('PRAGMA table_info(' + TABELA_SENHAS + ')').all();
  const tem = {};
  (info.results || []).forEach(c => { tem[c.name] = true; });
  const faltam = ['chave', 'sal', 'hash', 'uid', 'iter', 'ts'].filter(c => !tem[c]);
  if (faltam.length) throw new Error('tabela ' + TABELA_SENHAS + ' sem as colunas: ' + faltam.join(', '));

  /* A tabela da v10 guardava hash de senha e nao serve mais para nada.
     Deixa-la parada seria guardar segredo sem dono. */
  try { await env.DADOS.prepare('DROP TABLE IF EXISTS usuarios').run(); } catch (e) { /* nao atrapalha */ }
  _tabelaUsuariosOk = true;
}

/* A lista de aprovados do sistema (suplelive/autorizados/<uid>) chega ao
   espelho como qualquer outra colecao. Consulta-la aqui e o que impede
   uma conta criada por fora de semear senha: a configuracao do Firebase
   esta a vista na pagina, entao "ter um token do Firebase" nunca foi o
   mesmo que "trabalhar aqui". */
async function _autorizadoNoEspelho(env, uid) {
  if (!uid) return 'sem-autorizacao';
  const l = await env.DADOS.prepare(
    "SELECT 1 AS ok FROM registros WHERE colecao = 'autorizados' AND chave = ?1"
  ).bind(uid).first();
  if (l) return 'ok';
  /* Lista vazia nao e "voce nao trabalha aqui": e o espelho que ainda nao
     recebeu a copia desse ramo. Os dois casos recusam do mesmo jeito, mas
     dizem coisas diferentes — e quem le no console precisa saber qual dos
     dois consertar. */
  const algum = await env.DADOS.prepare(
    "SELECT 1 AS ok FROM registros WHERE colecao = 'autorizados' LIMIT 1"
  ).first();
  return algum ? 'sem-autorizacao' : 'espelho-sem-autorizados';
}

/* Teto por conta e por IP, na memoria do isolate. Nao e exato — cada
   isolate tem a sua conta — mas transforma forca bruta em algo inviavel,
   que e o objetivo. */
const LOGIN_TETO_MINUTO = 8;
const _loginRitmo = new Map();
function _passouDoRitmoLogin(id) {
  const janela = Math.floor(Date.now() / 60000);
  const r = _loginRitmo.get(id);
  if (!r || r.janela !== janela) {
    if (_loginRitmo.size > 5000) _loginRitmo.clear();   // nao cresce sem fim
    _loginRitmo.set(id, { janela, n: 1 });
    return false;
  }
  r.n++;
  return r.n > LOGIN_TETO_MINUTO;
}

async function atenderAuth(req, env, url) {
  /* O teto vem ANTES de tudo — antes do binding, antes de preparar tabela,
     antes do PBKDF2. Colocado depois, cada tentativa de forca bruta ainda
     custava trabalho de banco: o atacante nao entrava, mas derrubava o
     worker de cansaco. Aqui ele bate numa porta que nao abre nada.

     O worker responde num subdominio workers.dev, que nao pertence a uma
     zona nossa — logo o WAF e o rate limiting da Cloudflare NAO se aplicam.
     Sem este teto nao ha NADA entre a internet e o cofre de senhas.
     Conta e IP juntos de proposito: so por IP, um proxy passa; so por
     conta, varre-se a lista batendo uma vez em cada. */
  if (url.pathname === '/auth/entrar' || url.pathname === '/auth/semear') {
    const ip = req.headers.get('CF-Connecting-IP') || 'sem-ip';
    let quemTenta = '';
    try { const c = await req.clone().json(); quemTenta = String((c && c.chave) || ''); } catch (e) {}
    if (_passouDoRitmoLogin('ip:' + ip) || (quemTenta && _passouDoRitmoLogin('u:' + quemTenta))) {
      return respostaJson(429, { erro: 'muitas-tentativas' });
    }
  }
  if (!env.DADOS) return respostaJson(500, { erro: 'binding-DADOS-ausente' });
  if (!_segredoSessao(env)) return respostaJson(500, { erro: 'sem-segredo-de-sessao' });
  await garantirTabelas(env);
  await garantirTabelaUsuarios(env);

  /* Duas rotas de manutencao, abertas so pela chave do robo — que so o
     master tem. Existem para responder a unica pergunta que decide o
     desligamento do Firebase: todo mundo ja tem senha deste lado? */
  if (url.pathname === '/auth/semeados' || url.pathname === '/auth/soltar') {
    /* Ler a lista vale com o cracha comum — quem esta logado ja le o
       espelho inteiro, e a pergunta precisa ser respondivel do console do
       sistema, nao so de um terminal. Apagar, nao: destruir e sempre so
       pela chave do robo. */
    let podeLer = false;
    if (env.CHAVE_ROBO && (req.headers.get('X-LiveOps-Chave') || '') === env.CHAVE_ROBO) podeLer = true;
    if (url.pathname === '/auth/semeados') {
      if (!podeLer && !(await conferirTokenAutorizado(req, env))) return respostaJson(401, { erro: 'sem-login' });
    } else if (!podeLer) {
      return respostaJson(401, { erro: 'chave-invalida' });
    }
    if (url.pathname === '/auth/semeados') {
      const r = await env.DADOS.prepare('SELECT chave, ts FROM ' + TABELA_SENHAS + ' ORDER BY chave').all();
      const lista = (r.results || []).map(x => ({
        chave: x.chave, desde: new Date(x.ts).toISOString(),
      }));
      return respostaJson(200, { ok: true, total: lista.length, usuarios: lista });
    }
    /* Soltar uma chave e o conserto do caso raro: a conta do Firebase foi
       refeita, o uid mudou, e o dono nao consegue mais semear. Apagar a
       linha devolve o nome para o proximo login legitimo. */
    if (req.method !== 'POST') return respostaJson(405, { erro: 'metodo-nao-suportado' });
    const alvo = String(url.searchParams.get('chave') || '').trim().toLowerCase();
    if (!alvo) return respostaJson(400, { erro: 'falta-chave' });
    await env.DADOS.prepare('DELETE FROM ' + TABELA_SENHAS + ' WHERE chave = ?1').bind(alvo).run();
    return respostaJson(200, { ok: true, soltou: alvo });
  }

  if (req.method !== 'POST') return respostaJson(405, { erro: 'metodo-nao-suportado' });

  const corpo = await req.json().catch(() => null);
  const chave = String((corpo && corpo.chave) || '').trim().toLowerCase();
  const senha = String((corpo && corpo.senha) || '');
  if (!/^[a-z0-9_.-]{1,60}$/.test(chave) || senha.length < 4) {
    return respostaJson(400, { erro: 'dados-invalidos' });
  }

  /* Semear é o que faz a senha existir deste lado sem ninguém redefinir
     nada — e por isso exige que a pessoa JÁ tenha provado quem é nesta
     mesma requisição. Sem essa prova, qualquer um escolheria a senha de
     qualquer um. */
  /* O master define a senha de outra pessoa direto no cofre.
     Sem esta rota, semear dependia de a PROPRIA pessoa entrar — e entrar
     dependia do Firebase. Quem nunca tivesse semeado ficaria trancado no
     dia do desligamento, e a troca de senha pelo master viraria um beco
     sem saida: o cofre guardaria a senha antiga para sempre.
     So o master passa, e o cracha dele e conferido do mesmo jeito que em
     qualquer outra decisao de identidade. */
  if (url.pathname === '/auth/definir') {
    const quem = await conferirTokenAutorizado(req, env);
    if (!quem) return respostaJson(401, { erro: 'sem-login' });
    if (!_ehMestre(env, quem)) return respostaJson(403, { erro: 'so-master' });
    const sal = b64urlDeBytes(crypto.getRandomValues(new Uint8Array(16)).buffer);
    const feito = await _hashSenhaNoMaximo(senha, sal);
    await env.DADOS.prepare(
      'INSERT INTO ' + TABELA_SENHAS + ' (chave, sal, hash, uid, iter, ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ' +
      'ON CONFLICT(chave) DO UPDATE SET sal = ?2, hash = ?3, iter = ?5, ts = ?6'
    ).bind(chave, sal, feito.hash, '', feito.voltas, Date.now()).run();
    console.log('[auth] senha de', chave, 'definida pelo master');
    return respostaJson(200, { ok: true, chave, voltas: feito.voltas });
  }

  if (url.pathname === '/auth/semear') {
    const quem = await conferirTokenAutorizado(req, env);
    if (!quem) return respostaJson(401, { erro: 'sem-login' });
    const jaTem = await env.DADOS.prepare(
      'SELECT uid FROM ' + TABELA_SENHAS + ' WHERE chave = ?1'
    ).bind(chave).first();

    /* De QUEM e o cracha apresentado? Sem esta pergunta, estar logado
       bastaria para escolher a senha de qualquer um — e entrar como o
       master no dia em que o Firebase sair. Ter provado quem se e nunca
       foi o mesmo que ter provado quem se diz ser. */
    let uid;
    if (quem.iss === 'liveops') {
      // Cracha deste worker: ele proprio diz de quem e. Trocar a senha
      // da propria conta, sim; a de outra, nao.
      if (String(quem.chave || '') !== chave) {
        return respostaJson(403, { erro: 'chave-de-outra-pessoa' });
      }
      uid = '';   // preservado abaixo, no COALESCE
    } else {
      uid = String(quem.sub || '');
      const veredito = await _autorizadoNoEspelho(env, uid);
      if (veredito !== 'ok') return respostaJson(403, { erro: veredito });
      /* Quem chega primeiro fica com o nome: o primeiro a entrar como
         `master` e o master, porque so ele tem a senha do master. Dali em
         diante a conta e dele, e outro uid nao a sobrescreve. */
      if (jaTem && jaTem.uid && jaTem.uid !== uid) {
        return respostaJson(403, { erro: 'chave-de-outra-pessoa' });
      }
    }

    const sal = b64urlDeBytes(crypto.getRandomValues(new Uint8Array(16)).buffer);
    const feito = await _hashSenhaNoMaximo(senha, sal);
    await env.DADOS.prepare(
      'INSERT INTO ' + TABELA_SENHAS + ' (chave, sal, hash, uid, iter, ts) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ' +
      // NULLIF/COALESCE: cracha proprio nao traz uid, e um vazio nao pode
      // apagar o dono ja registrado
      'ON CONFLICT(chave) DO UPDATE SET sal = ?2, hash = ?3, ' +
      ' uid = COALESCE(NULLIF(?4, \'\'), uid), iter = ?5, ts = ?6'
    ).bind(chave, sal, feito.hash, uid, feito.voltas, Date.now()).run();
    return respostaJson(200, { ok: true, voltas: feito.voltas });
  }

  if (url.pathname === '/auth/entrar') {
    const linha = await env.DADOS.prepare(
      'SELECT sal, hash, iter FROM ' + TABELA_SENHAS + ' WHERE chave = ?1'
    ).bind(chave).first();
    /* "Ainda não cadastrada" é resposta própria: o sistema sabe que deve
       tentar pelo Firebase e semear em seguida. */
    if (!linha) return respostaJson(404, { erro: 'sem-cadastro' });
    // Cada linha lembra com quantas voltas foi feita: conferir é refazer
    // a MESMA conta, não a conta que este worker faria hoje.
    const hash = await _hashSenha(senha, linha.sal, linha.iter || PBKDF2_ESCADA[0]);
    if (!_iguaisNoTempo(hash, linha.hash)) return respostaJson(401, { erro: 'senha-incorreta' });
    const t = await _emitirToken(env, chave);
    return respostaJson(200, { ok: true, token: t.token, exp: t.exp, chave });
  }

  return respostaJson(404, { erro: 'rota-desconhecida' });
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
  /* Ordenar por ts sem indice varreria a colecao inteira a cada leitura de
     "ultimos". Falhar aqui nao quebra nada — so fica mais lento —, mas o
     motivo aparece, que e a licao do ALTER TABLE engolido em silencio. */
  try {
    await env.DADOS.prepare(
      'CREATE INDEX IF NOT EXISTS idx_registros_colecao_ts ON registros (colecao, ts)'
    ).run();
  } catch (e) {
    console.warn('[dados] indice colecao/ts nao criado:', (e && e.message) || e);
  }
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
        a.chave = String(m.chave || '').slice(0, 60);
        a.cor = String(m.cor || '').slice(0, 20);
        a.desde = Number(m.desde) || Date.now();
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
        if (a.uid) lista.push({ uid: a.uid, nome: a.nome || '', chave: a.chave || '',
          cor: a.cor || '', desde: a.desde || 0 });
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
  /* Coleção é o ramo onde os registros ficam pendurados: reg/pedidosBase,
     inbox/conv — dois níveis. As mensagens do Inbox têm um nível a mais
     (inbox/msg/<conversa>/<mensagem>), e sem esta exceção a importação do
     histórico teria de gravar uma mensagem por chamada: dezenas de
     milhares delas, uma a uma. */
  const ehMsgDaConversa = partes.length === 3 && partes[0] === 'inbox' && partes[1] === 'msg';
  const ehColecao = partes.length <= 2 || ehMsgDaConversa;
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
    /* ?somenteNovos=1 — v20. Grava so o que ainda nao existe.

       O fluxo de pedidos tem dois ramos que rodam juntos: a API traz o
       pedido inteiro (telefone, status, canal) e a nota fiscal reconstroi
       o que esta no Arquivo, sem esses campos. O ramo da nota decidia o que
       gravar por uma foto tirada no comeco da execucao — e durante os dois
       minutos seguintes o outro ramo escrevia por baixo. Resultado: a nota
       passava por cima do pedido bom e sumia com o telefone.

       Aqui a garantia deixa de depender de tempo: quem manda gravar so o
       novo nao sobrescreve nada, aconteca o que acontecer no meio. */
    const somenteNovos = url.searchParams.get('somenteNovos') === '1';
    let ignoradas = 0;
    for (let i = 0; i < chaves.length; i += LOTE_MAX) {
      const lote = [];
      for (const k of chaves.slice(i, i + LOTE_MAX)) {
        if (somenteNovos && existentes[k] !== undefined) { ignoradas++; continue; }
        const json = _juntarCampos(existentes[k], corpo[k]);
        if (json.length > LINHA_MAX) continue;
        lote.push(insere.bind(colecao, k, json, agora));
        mudancas.push({ colecao, chave: k });
      }
      if (lote.length) { await env.DADOS.batch(lote); gravadasAgora += lote.length; }
    }
    if (ignoradas) console.log('[robo] somenteNovos: ' + ignoradas + ' ja existiam e ficaram como estavam');

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

/* ══════════════════════════════════════════════════════════════════
   API REST DO LIVEOPS (v1)
   ══════════════════════════════════════════════════════════════════
   A porta para o mundo de fora: planilha, script, parceiro, qualquer
   ferramenta que precise ler ou gravar dados do LiveOps sem ser o
   próprio sistema nem um fluxo do n8n. Nomes amigáveis, JSON limpo,
   paginação — e a mesma disciplina de escrita do resto do worker:
   grava no D1, repassa ao Firebase enquanto a convivência durar, e
   avisa a sala para as telas abertas verem na hora.

     GET    /api/v1                       → lista os recursos
     GET    /api/v1/<recurso>             → página de registros
              ?limite=100 (máx 1000) · ?depois=<id> (cursor)
              ?desde=<ts> (só o que mudou depois desse timestamp)
              ?ultimos=1 (o fim da lista, não o começo)
     GET    /api/v1/<recurso>/<id>        → um registro
     POST   /api/v1/<recurso>             → cria (corpo = campos)
     PATCH  /api/v1/<recurso>/<id>        → altera só os campos enviados
     PUT    /api/v1/<recurso>/<id>        → substitui o registro
     DELETE /api/v1/<recurso>/<id>        → remove

   Quem pode: cada PARCEIRO tem a sua própria chave, com escopo próprio —
   quais recursos enxerga e se pode escrever. A chave vai no cabeçalho
   X-LiveOps-Chave. Uma pessoa logada no sistema também lê pela API (com
   o crachá de sessão), mas escrever é sempre por chave.

   As chaves dos parceiros nascem e morrem por aqui:

     GET    /api/v1/chaves          → lista (sem os segredos, que não voltam)
     POST   /api/v1/chaves          → cria {nome, recursos:[…], escrever}
                                      e devolve a chave UMA vez
     DELETE /api/v1/chaves/<id>     → revoga na hora

   Quem administra chaves: o master — pelo cabeçalho X-LiveOps-Chave com
   a CHAVE_ROBO, ou pelo próprio login (env MASTER_CHAVE = o usuário do
   master; MASTER_UID = o uid dele no Firebase, durante a convivência).

   A chave guardada é só o SHA-256 dela: de quem tiver o banco na mão não
   se tira a chave de volta — some junto com o parceiro se ele a perder,
   e aí se cria outra. O segredo CHAVE_API continua valendo como chave
   mestra de acesso total (compatibilidade); para parceiro, use uma chave
   nomeada, que se revoga sozinha sem derrubar os outros. */
const API_RECURSOS = {
  pedidos:           'reg/pedidosBase',
  tarefas:           'reg/atividades',
  produtos:          'reg/produtos',
  vendas:            'reg/pedidosWpp',
  rastreios:         'reg/rastreios',
  devolucoes:        'reg/devolucoes',
  atendimentos:      'reg/atendimentos',
  acompanhamentos:   'reg/acompanhamentos',
  leads:             'reg/leads',
  templates:         'reg/tplMsgs',
  entradas:          'reg/entradas',
  'entradas-estoque':'reg/entradasEstoque',
  canceladas:        'reg/canceladas',
  'canceladas-nf':   'reg/canceladasNF',
  projetos:          'reg/projetos',
};

let _tabelaChavesOk = false;
async function garantirTabelaChaves(env) {
  if (_tabelaChavesOk) return;
  await env.DADOS.prepare(
    'CREATE TABLE IF NOT EXISTS chaves_api (' +
    ' id TEXT PRIMARY KEY, nome TEXT NOT NULL, hash TEXT NOT NULL,' +
    ' recursos TEXT NOT NULL, escrever INTEGER NOT NULL, ativa INTEGER NOT NULL,' +
    ' criada INTEGER NOT NULL, ultimo_uso INTEGER, chamadas INTEGER NOT NULL DEFAULT 0)'
  ).run();
  _tabelaChavesOk = true;
}

async function _sha256(texto) {
  const bits = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(texto)));
  return b64urlDeBytes(bits);
}

/* Um teto por chave, contado na memória deste isolate. Não é uma cota
   exata — cada isolate tem a sua conta — mas é o que impede um laço
   desgovernado de um parceiro consumir o plano inteiro numa madrugada. */
const API_TETO_MINUTO = 600;
const _apiRitmo = new Map();
function _passouDoRitmo(id) {
  const agora = Date.now(), janela = Math.floor(agora / 60000);
  const r = _apiRitmo.get(id);
  if (!r || r.janela !== janela) { _apiRitmo.set(id, { janela, n: 1 }); return false; }
  r.n++;
  return r.n > API_TETO_MINUTO;
}

/* Quem está batendo na porta: uma chave de parceiro, a chave mestra, ou
   uma pessoa logada no sistema. Devolve o portador com o que ele pode —
   ou null. Um só lugar decide isso; as rotas só perguntam. */
async function _portadorDaApi(req, env) {
  const chave = (req.headers.get('X-LiveOps-Chave') || '').trim();
  if (chave) {
    // Chave mestra (segredo do worker): acesso total, sem escopo
    if ((env.CHAVE_API && chave === env.CHAVE_API) ||
        (!env.CHAVE_API && env.CHAVE_ROBO && chave === env.CHAVE_ROBO)) {
      return { tipo: 'mestra', nome: 'chave mestra', recursos: ['*'], escrever: true, mestre: true };
    }
    // Chave de parceiro: lo_<id>_<segredo>
    const m = /^lo_([A-Za-z0-9]{6})_([A-Za-z0-9_-]{20,})$/.exec(chave);
    if (m) {
      await garantirTabelaChaves(env);
      const l = await env.DADOS.prepare(
        'SELECT id, nome, hash, recursos, escrever, ativa FROM chaves_api WHERE id = ?1'
      ).bind(m[1]).first();
      if (!l || !l.ativa) return null;
      if (!_iguaisNoTempo(await _sha256(chave), l.hash)) return null;
      let recursos = ['*'];
      try { const p = JSON.parse(l.recursos); if (Array.isArray(p) && p.length) recursos = p; } catch (e) {}
      return { tipo: 'parceiro', id: l.id, nome: l.nome, recursos, escrever: !!l.escrever };
    }
    /* A CHAVE_ROBO abre a administração de chaves mesmo quando existe uma
       CHAVE_API: é o crachá do master, e é por ele que se cria a primeira. */
    if (env.CHAVE_ROBO && chave === env.CHAVE_ROBO) {
      return { tipo: 'robo', nome: 'chave do robô', recursos: ['*'], escrever: true, mestre: true };
    }
    return null;
  }
  // Pessoa logada: lê, não escreve — e é master se o worker souber quem é
  const quem = await conferirTokenAutorizado(req, env);
  if (!quem) return null;
  const mestre = !!((env.MASTER_CHAVE && quem.iss === 'liveops' && String(quem.chave || '') === env.MASTER_CHAVE) ||
                    (env.MASTER_UID && String(quem.sub || '') === env.MASTER_UID));
  return { tipo: 'pessoa', nome: String(quem.chave || quem.sub || 'pessoa'), recursos: ['*'], escrever: false, mestre };
}

function _podeNoRecurso(portador, recurso) {
  return portador.recursos.indexOf('*') >= 0 || portador.recursos.indexOf(recurso) >= 0;
}

/* Marcar o uso é útil (o master vê no painel quem está ativo) e nunca
   pode atrasar a resposta nem derrubá-la se falhar. */
function _marcarUso(env, ctx, portador) {
  if (portador.tipo !== 'parceiro') return;
  ctx.waitUntil(env.DADOS.prepare(
    'UPDATE chaves_api SET ultimo_uso = ?1, chamadas = chamadas + 1 WHERE id = ?2'
  ).bind(Date.now(), portador.id).run().catch(() => {}));
}

/* ── Administração das chaves (só o master) ───────────────────────── */
async function atenderChavesApi(req, env, url, portador, id) {
  if (!portador || !portador.mestre) return respostaJson(403, { erro: 'so-o-master-administra-chaves' });
  await garantirTabelaChaves(env);

  if (req.method === 'GET') {
    const rs = await env.DADOS.prepare(
      'SELECT id, nome, recursos, escrever, ativa, criada, ultimo_uso, chamadas FROM chaves_api ORDER BY criada DESC'
    ).all();
    return respostaJson(200, {
      ok: true,
      chaves: (rs.results || []).map(l => ({
        id: l.id, nome: l.nome,
        recursos: (() => { try { return JSON.parse(l.recursos); } catch (e) { return ['*']; } })(),
        escrever: !!l.escrever, ativa: !!l.ativa,
        criada: l.criada, ultimoUso: l.ultimo_uso || null, chamadas: l.chamadas || 0,
      })),
    });
  }

  if (req.method === 'POST') {
    const corpo = await req.json().catch(() => null);
    const nome = String((corpo && corpo.nome) || '').trim().slice(0, 60);
    if (!nome) return respostaJson(400, { erro: 'falta-o-nome-do-parceiro' });
    let recursos = ['*'];
    if (corpo && Array.isArray(corpo.recursos) && corpo.recursos.length) {
      recursos = corpo.recursos.filter(r => r === '*' || API_RECURSOS[r]);
      if (!recursos.length) return respostaJson(400, { erro: 'recursos-desconhecidos', recursos: Object.keys(API_RECURSOS) });
    }
    const escrever = !!(corpo && corpo.escrever);
    // id curto e visível (identifica a chave sem revelá-la) + segredo longo
    const alfa = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const sorteio = crypto.getRandomValues(new Uint8Array(6));
    const idNovo = Array.from(sorteio).map(b => alfa[b % alfa.length]).join('');
    const segredo = b64urlDeBytes(crypto.getRandomValues(new Uint8Array(24)).buffer);
    const chaveInteira = 'lo_' + idNovo + '_' + segredo;
    await env.DADOS.prepare(
      'INSERT INTO chaves_api (id, nome, hash, recursos, escrever, ativa, criada, chamadas) ' +
      'VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, 0)'
    ).bind(idNovo, nome, await _sha256(chaveInteira), JSON.stringify(recursos), escrever ? 1 : 0, Date.now()).run();
    /* A chave inteira aparece AQUI e nunca mais: o banco guarda só o
       hash. Perdida, cria-se outra — que é o certo, e não descobri-la. */
    return respostaJson(201, { ok: true, id: idNovo, nome, chave: chaveInteira, recursos, escrever });
  }

  if (req.method === 'DELETE') {
    if (!id) return respostaJson(400, { erro: 'falta-o-id-da-chave' });
    await env.DADOS.prepare('DELETE FROM chaves_api WHERE id = ?1').bind(id).run();
    return respostaJson(200, { ok: true, revogada: id });
  }
  return respostaJson(405, { erro: 'metodo-nao-suportado' });
}

async function atenderApi(req, env, ctx, url) {
  if (!env.DADOS) return respostaJson(500, { erro: 'binding-DADOS-ausente' });
  await garantirTabelas(env);

  const partes = url.pathname.replace(/^\/api\/v1\/?/, '').split('/').filter(Boolean);
  const portador = await _portadorDaApi(req, env);

  if (!partes.length) {
    if (!portador) return respostaJson(401, { erro: 'sem-autorizacao' });
    return respostaJson(200, {
      ok: true, versao: VERSAO_WORKER, quem: portador.nome,
      escrever: portador.escrever,
      recursos: portador.recursos.indexOf('*') >= 0 ? Object.keys(API_RECURSOS) : portador.recursos,
    });
  }

  // A administração das chaves dos parceiros mora aqui, antes dos recursos
  if (partes[0] === 'chaves') {
    if (partes.length > 2) return respostaJson(400, { erro: 'caminho-invalido' });
    return atenderChavesApi(req, env, url, portador, partes[1] || '');
  }

  const recurso = partes[0];
  const colecao = API_RECURSOS[recurso];
  if (!colecao) return respostaJson(404, { erro: 'recurso-desconhecido', recursos: Object.keys(API_RECURSOS) });
  const id = partes[1] || '';
  if (partes.length > 2 || (id && !CHAVE_OK.test(id))) return respostaJson(400, { erro: 'caminho-invalido' });

  if (!portador) return respostaJson(401, { erro: 'sem-autorizacao' });
  if (portador.id && _passouDoRitmo(portador.id)) {
    return respostaJson(429, { erro: 'ritmo-excedido', limite: API_TETO_MINUTO + '/min' });
  }
  if (!_podeNoRecurso(portador, recurso)) {
    return respostaJson(403, { erro: 'recurso-fora-do-escopo-desta-chave', liberados: portador.recursos });
  }
  if (req.method !== 'GET' && !portador.escrever) {
    return respostaJson(403, { erro: 'esta-chave-so-le' });
  }
  _marcarUso(env, ctx, portador);

  if (req.method === 'GET') {
    if (id) {
      const l = await env.DADOS.prepare(
        'SELECT dados, ts FROM registros WHERE colecao = ?1 AND chave = ?2'
      ).bind(colecao, id).first();
      if (!l) return respostaJson(404, { erro: 'nao-achado' });
      return resposta(200, '{"ok":true,"id":' + JSON.stringify(id) + ',"ts":' + (l.ts || 0) + ',"dados":' + l.dados + '}',
        { 'Content-Type': 'application/json' });
    }
    let limite = parseInt(url.searchParams.get('limite') || '100', 10);
    if (!(limite > 0 && limite <= 1000)) limite = 100;
    const depois = url.searchParams.get('depois') || '';
    const desde = parseInt(url.searchParams.get('desde') || '0', 10) || 0;
    const doFim = url.searchParams.get('ultimos') === '1';
    const rs = doFim
      ? await env.DADOS.prepare(
          // Mesmo motivo do /dados/colecao: chave nem sempre e cronologica
          'SELECT chave, dados, ts FROM registros WHERE colecao = ?1 AND ts > ?2 ORDER BY ts DESC, rowid DESC LIMIT ?3'
        ).bind(colecao, desde, limite).all()
      : await env.DADOS.prepare(
          'SELECT chave, dados, ts FROM registros WHERE colecao = ?1 AND chave > ?2 AND ts > ?3 ORDER BY chave LIMIT ?4'
        ).bind(colecao, depois, desde, limite).all();
    const linhas = rs.results || [];
    if (doFim) linhas.reverse();
    const corpo = '{"ok":true,"recurso":' + JSON.stringify(recurso) + ',"itens":[' +
      linhas.map(l => '{"id":' + JSON.stringify(l.chave) + ',"ts":' + (l.ts || 0) + ',"dados":' + l.dados + '}').join(',') +
      '],"proxima":' + ((!doFim && linhas.length === limite) ? JSON.stringify(linhas[linhas.length - 1].chave) : 'null') + '}';
    return resposta(200, corpo, { 'Content-Type': 'application/json' });
  }

  if (['POST', 'PATCH', 'PUT', 'DELETE'].indexOf(req.method) < 0) {
    return respostaJson(405, { erro: 'metodo-nao-suportado' });
  }
  if (req.method === 'POST' ? !!id : !id) {
    return respostaJson(400, { erro: req.method === 'POST' ? 'post-e-na-lista' : 'falta-o-id' });
  }

  const texto = req.method === 'DELETE' ? '' : await req.text();
  let corpo = null;
  if (texto) {
    if (texto.length > LINHA_MAX) return respostaJson(413, { erro: 'registro-grande-demais' });
    try { corpo = JSON.parse(texto); } catch (e) { return respostaJson(400, { erro: 'json-invalido' }); }
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
      return respostaJson(400, { erro: 'esperava-um-objeto' });
    }
  }
  const agora = Date.now();
  /* Quem gravou fica no próprio registro. Sem isso, dado entrando por
     três parceiros diferentes vira um só borrão quando alguém pergunta
     "de onde veio isto?". */
  const marca = { _apiPor: portador.nome, _apiEm: agora };
  const insere = env.DADOS.prepare(
    'INSERT INTO registros (colecao, chave, dados, ts) VALUES (?1, ?2, ?3, ?4) ' +
    'ON CONFLICT(colecao, chave) DO UPDATE SET dados = ?3, ts = ?4'
  );

  /* Criar: o Firebase inventa a chave primeiro (repasse ANTES), para os
     dois bancos ficarem com o MESMO id — igual ao POST dos robôs. */
  if (req.method === 'POST') {
    if (!corpo) return respostaJson(400, { erro: 'corpo-vazio' });
    const r = await repassarAoFirebase(env, colecao, 'POST', texto);
    const novo = (r.dados && r.dados.name) ? r.dados.name : ('api' + Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 8));
    if (!CHAVE_OK.test(novo)) return respostaJson(500, { erro: 'chave-gerada-invalida' });
    const json = JSON.stringify({ ...corpo, id: corpo.id || novo, ...marca });
    await insere.bind(colecao, novo, json, agora).run();
    ctx.waitUntil(avisarSala(env, { linhas: [{ colecao, chave: novo }] }));
    return respostaJson(201, { ok: true, id: novo, firebase: r.status });
  }

  if (req.method === 'DELETE') {
    await env.DADOS.prepare('DELETE FROM registros WHERE colecao = ?1 AND chave = ?2').bind(colecao, id).run();
    ctx.waitUntil(avisarSala(env, { linhas: [{ colecao, chave: id, apagada: true }] }));
    const r = await repassarAoFirebase(env, colecao + '/' + id, 'DELETE', undefined);
    return respostaJson(200, { ok: true, id, firebase: r.status });
  }

  // PATCH junta com o que existe; PUT substitui. Registro novo por PUT
  // também vale — é como um integrador grava com id próprio.
  const atual = await env.DADOS.prepare(
    'SELECT dados FROM registros WHERE colecao = ?1 AND chave = ?2'
  ).bind(colecao, id).first();
  if (req.method === 'PATCH' && !atual) return respostaJson(404, { erro: 'nao-achado' });
  const json = req.method === 'PATCH'
    ? _juntarCampos(atual && atual.dados, { ...corpo, ...marca })
    : JSON.stringify({ ...(corpo || {}), id: (corpo && corpo.id) || id, ...marca });
  if (json.length > LINHA_MAX) return respostaJson(413, { erro: 'registro-grande-demais' });
  await insere.bind(colecao, id, json, agora).run();
  ctx.waitUntil(avisarSala(env, { linhas: [{ colecao, chave: id }] }));
  const r = await repassarAoFirebase(env, colecao + '/' + id, req.method === 'PATCH' ? 'PATCH' : 'PUT',
    req.method === 'PATCH' ? texto : json);
  return respostaJson(200, { ok: true, id, firebase: r.status });
}

export default {
  /* O CORS e decidido na SAIDA, aqui, e nao em cada resposta: um lugar so,
     sem estado global, sem risco de a origem de um pedido vazar para a
     resposta de outro. */
  async fetch(req, env, ctx) {
    return _comCors(req, await _atender(req, env, ctx));
  },
};

async function _atender(req, env, ctx) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return resposta(204, null);
    if (url.pathname === '/saude') return resposta(200, 'ok ' + VERSAO_WORKER, { 'Content-Type': 'text/plain' });

    /* Os robôs entram por outra porta: chave própria, sem login de pessoa.
       Um erro aqui não pode virar "exceção não tratada": o n8n mostraria
       só que "o serviço não conseguiu processar", sem dizer o quê. O
       motivo volta escrito, na execução do fluxo, onde alguém vai ler. */
    if (url.pathname.indexOf('/auth/') === 0) {
      /* O nome da exceção e a primeira linha da pilha vêm junto de
         propósito: sem elas, "falha-no-worker" é só a notícia de que algo
         quebrou — e uma manhã inteira se vai adivinhando o quê. */
      return atenderAuth(req, env, url).catch(e => {
        /* O detalhe e o que salva a manha de depuracao — mas ele vai para
           o log do worker (wrangler tail / Workers Logs), nao para quem
           chamou. Devolver nome de funcao, arquivo e linha era entregar o
           mapa da rota mais sensivel a quem so provocou um erro. */
        console.error('[auth]', (e && e.stack) || e);
        return respostaJson(500, { erro: 'falha-no-worker' });
      });
    }

    if (url.pathname.indexOf('/robo/') === 0) {
      return atenderRobo(req, env, ctx, url).catch(e => {
        console.error('[robo]', (e && e.stack) || e);
        return respostaJson(500, { erro: 'falha-no-worker' });
      });
    }

    // A API REST (v1): a porta das integrações de fora
    if (url.pathname === '/api/v1' || url.pathname.indexOf('/api/v1/') === 0) {
      return atenderApi(req, env, ctx, url).catch(e => {
        console.error('[api]', (e && e.stack) || e);
        return respostaJson(500, { erro: 'falha-no-worker' });
      });
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
      const quemRt = await conferirTokenBrutoAutorizado(url.searchParams.get('token') || '', env);
      if (!quemRt) return respostaJson(401, { erro: 'sem-login' });
      const cab = new Headers(req.headers);
      cab.set('X-Uid', quemRt.sub);
      const id = env.SALA.idFromName('liveops');
      return env.SALA.get(id).fetch(new Request('https://sala/ws', { method: 'GET', headers: cab }));
    }

    const quem = await conferirToken(req, env);
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
        /* ?ultimos=1 devolve o FIM da lista, não o começo. Feed de atividade
           e avisos só querem as últimas dezenas de um ramo com milhares —
           ler tudo para jogar fora quase tudo é o desperdício que esta
           migração existe para acabar.

           Ordenava por chave, apostando que chave é cronológica. Vale para
           as chaves do Firebase (-N...), NÃO vale para as mensagens do
           inbox: o id do Chatwoot é número, e como TEXTO '9' vem depois de
           '1000'. As "últimas 120" de uma conversa voltavam sendo as que
           começam com 9, depois com 8 — um pedaço torto do histórico. O
           Firebase pedia orderByChild('ts') e nunca teve esse problema.

           Agora ordena por ts, que é o que "último" quer dizer. O rowid
           desempata: no histórico que veio da migração em bloco todos os
           ts são iguais, e a ordem de inserção preserva a cronologia. */
        const doFim = url.searchParams.get('ultimos') === '1';
        const rs = doFim
          ? await env.DADOS.prepare(
              'SELECT chave, dados, ts FROM registros WHERE colecao = ?1 ORDER BY ts DESC, rowid DESC LIMIT ?2'
            ).bind(nome, limite).all()
          : await env.DADOS.prepare(
              'SELECT chave, dados, ts FROM registros WHERE colecao = ?1 AND chave > ?2 ORDER BY chave LIMIT ?3'
            ).bind(nome, depois, limite).all();
        const linhas = (rs.results || []);
        if (doFim) linhas.reverse();
        const corpo = '{"linhas":[' + linhas.map(l =>
          '{"chave":' + JSON.stringify(l.chave) + ',"ts":' + (l.ts || 0) + ',"dados":' + l.dados + '}'
        ).join(',') + '],"proxima":' +
          ((!doFim && linhas.length === limite) ? JSON.stringify(linhas[linhas.length - 1].chave) : 'null') + '}';
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
        let puladas = 0, recusadas = 0;
        const agora = Date.now();
        const mestre = _ehMestre(env, quem);
        for (const l of linhas) {
          const colecao = l && l.colecao, chave = l && l.chave;
          if (typeof colecao !== 'string' || typeof chave !== 'string'
            || !COLECAO_OK.test(colecao) || !CHAVE_OK.test(chave)) { puladas++; continue; }
          /* Gravar o proprio trabalho e o dia a dia da equipe; gravar QUEM
             EU SOU e decisao do master. Sem esta linha, um POST de uma
             linha so na colecao autorizados promovia o autor a usuario
             legitimo — e dai a master. */
          if (COLECOES_PROTEGIDAS.has(colecao) && !mestre) { recusadas++; continue; }
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
        if (recusadas) console.warn('[dados] recusadas', recusadas, 'gravacao(oes) em colecao protegida por', (quem && (quem.chave || quem.sub)) || '?');
        return respostaJson(200, { ok: true, gravadas: stmts.length, puladas, recusadas });
      }

      if (url.pathname === '/dados/resumo' && req.method === 'GET') {
        // O inventario do banco inteiro e assunto de dono, nao de sessao comum
        if (!_ehMestre(env, quem)) return respostaJson(403, { erro: 'so-master' });
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
      /* Percorrer o R2 inteiro (ate 50 mil chaves) e um laco caro que
         qualquer sessao disparava a vontade. So o master. */
      if (!_ehMestre(env, quem)) return respostaJson(403, { erro: 'so-master' });
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
}
