/**
 * LiveOps — Registro de Vendas + Comprovantes
 *
 * Este arquivo é o projeto ÚNICO do LiveOps: atende as vendas e também o
 * proxy de consulta de CPF, que antes vivia num projeto separado. Ficou tudo
 * junto porque o código de vendas foi colado por cima do proxy — em vez de
 * separar de novo, os dois convivem na mesma implantação, e o index.html
 * aponta a mesma URL nas duas constantes (PLANILHA_VENDAS_URL e CPF_PROXY_URL).
 *
 * O que este script faz:
 *   acao 'criar' | 'editar' | 'excluir'  → mantém a planilha de vendas
 *   acao 'comprovante'                   → salva o print na pasta do MÊS,
 *                                          com o nome "DD.MM - Nº do pedido"
 *   acao 'vendas'                        → devolve a planilha para a tela
 *                                          de Conferência de Vendas
 *   ?cpf=00000000000                     → repassa a consulta da GhostAPIs
 *
 * COMO PUBLICAR (a cada alteração):
 *   Implantar → Gerenciar implantações → editar (lápis) →
 *   Versão: Nova versão → Implantar.
 *   Executar como: Eu · Quem pode acessar: Qualquer pessoa.
 *   Se criar uma implantação NOVA, a URL muda e precisa ser trocada no
 *   index.html (constante PLANILHA_VENDAS_URL).
 */

/* Marca de qual código está publicado. Só serve para /exec?acao=diag
   responder "a implantação no ar é esta aqui" — sem isso, não há como saber
   de fora se o "Nova versão" chegou a ser feito. Suba junto com o arquivo. */
var VERSAO_CODIGO = '2026.08.17e';

// Pasta "Comprovantes" no Drive — a que tem as pastas de cada mês dentro
var PASTA_COMPROVANTES_ID = '1H6rq8v0ZHJfcgp3QTAnKWYrPQJfQoTsr';

// Planilha "Registro de Vendas WhatsApp"
var PLANILHA_ID  = '15aF5lcOi2Xg7iKuhsfcmxPALLUKHEqg5HRm7jmiAzhY';
// A aba é escolhida pelo gid da URL da planilha (…#gid=1231262605). Deixando
// GID_VENDAS em null, usa a primeira aba.
var GID_VENDAS   = 1231262605;
var ABA_VENDAS   = '';   // alternativa ao gid: o nome da aba

/* Token da GhostAPIs (consulta de CPF). Como o do Chatwoot, vive nas
   Propriedades do Script — este arquivo está num repositório PÚBLICO, e
   token colado aqui fica à vista de qualquer pessoa que abrir o GitHub.
   Cadastre em: Configurações do projeto → Propriedades do script →
   nome GHOST_TOKEN, valor = o token. */
function ghostToken() { return _propriedade('GHOST_TOKEN'); }

/* ── Chatwoot ────────────────────────────────────────────────
   Usado pelo Live CPF para descobrir quais telefones já falaram com a gente.
   O token fica AQUI, no Apps Script, e não no index.html: o sistema é
   publicado no GitHub Pages, então qualquer chave colada lá fica à vista de
   quem abrir o código-fonte da página. Um token do Chatwoot dá acesso à conta
   inteira — histórico de conversas de todos os clientes.

   Onde achar cada coisa:
   · CHATWOOT_URL        → o endereço que você usa para acessar (sem barra no
                           fim). Ex.: https://app.chatwoot.com
   · CHATWOOT_ACCOUNT_ID → o número que aparece na URL depois de /accounts/
   · CHATWOOT_TOKEN      → Perfil → Configurações do perfil → Token de acesso
                           (access token). Prefira um usuário só para isso. */
var CHATWOOT_URL        = 'https://chat.suplelive.com.br';
var CHATWOOT_ACCOUNT_ID = '1';

/* O TOKEN NÃO FICA NO CÓDIGO. Ele vive nas Propriedades do Script:
   Apps Script → engrenagem (Configurações do projeto) → Propriedades do
   script → Adicionar propriedade → nome CHATWOOT_TOKEN, valor = o token.

   Dois motivos: este arquivo vai para o GitHub, e um token do Chatwoot dá
   acesso ao histórico de conversas de todos os clientes; e assim ele
   sobrevive a colar uma versão nova do código por cima — foi exatamente
   esse tipo de descuido que apagou o proxy de CPF antes. */
function _propriedade(nome) {
  try { return (PropertiesService.getScriptProperties().getProperty(nome) || '').trim(); }
  catch (err) { return ''; }
}
function chatwootToken() { return _propriedade('CHATWOOT_TOKEN'); }

/* Caixa de entrada do WhatsApp — FIXA de propósito.
   A conta tem duas caixas (3 · "2. Antigo" e 9 · "1. Oficial"), as duas do
   tipo Channel::Api e nenhuma com "whatsapp" no nome. A descoberta automática
   pegaria a primeira da lista, que é a antiga: os atendimentos sairiam pelo
   número desativado e ninguém perceberia — o disparo responderia "enviado"
   do mesmo jeito. Se a caixa oficial mudar, troque o número aqui.
   Vazio = volta a descobrir sozinho (ver inboxDoWhatsApp). */
var CHATWOOT_INBOX_ID = '9';

// O comando que dispara o template aprovado, digitado pelo atendente hoje
var CHATWOOT_COMANDO  = '/iniciar_atendimento';

// ─────────────────────────────────────────────────────────────
// ENTRADA
// ─────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    var corpo = (e && e.postData && e.postData.contents) || '{}';
    var d = JSON.parse(corpo);
    var acao = String(d.acao || '');

    if (acao === 'comprovante') return _json(salvarComprovante(d));
    if (acao === 'formas') return _json(sincronizarFormas(d.formas || [], d.mes || ''));
    if (acao === 'criar' || acao === 'editar' || acao === 'excluir') {
      return _json(gravarNaPlanilha(acao, d));
    }
    return _json({ ok: false, erro: 'Ação desconhecida: ' + acao });

  } catch (err) {
    // O erro fica no log da execução (Apps Script → Execuções)
    console.error(err);
    return _json({ ok: false, erro: String(err) });
  }
}

/**
 * Leitura da planilha pelo sistema (aba "Conferência Vendas").
 *   /exec                → responde se o serviço está no ar
 *   /exec?acao=vendas    → devolve o cabeçalho e todas as linhas
 *
 * Devolve as colunas como estão na planilha, sem inventar nome nem ordem:
 * a tela monta a tabela com o que vier. Assim, mexer na planilha não quebra
 * o sistema.
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var acao = p.acao || '';

  // Proxy de CPF — a GhostAPIs bloqueia a chamada direta do navegador (CORS),
  // então quem busca é o servidor do Google. A resposta volta como veio.
  if (acao === 'cpf' || p.cpf) {
    var cpf = String(p.cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11) return _json({ status: false, erro: 'CPF invalido — envie 11 digitos' });
    // Sem token a GhostAPIs devolve uma recusa generica, e na tela isso virava
    // "sem retorno para este CPF" — parecia culpa do CPF. Avisa o que falta.
    if (!ghostToken()) {
      return _json({ status: false, erro: 'GHOST_TOKEN nao cadastrado — Configuracoes do projeto > Propriedades do script' });
    }
    try {
      var resp = UrlFetchApp.fetch(
        'https://ghostapis.com/api.php?token=' + ghostToken() + '&cpf_simples=' + cpf,
        { muteHttpExceptions: true, followRedirects: true });
      var texto = resp.getContentText();
      try { return _json(JSON.parse(texto)); }
      catch (parseErr) {
        return _json({ status: false, erro: 'Resposta nao e JSON valido', bruto: texto.slice(0, 500) });
      }
    } catch (err) {
      return _json({ status: false, erro: String(err) });
    }
  }

  // Live CPF: o telefone já conversou com a gente pelo Chatwoot?
  if (acao === 'chatwoot') {
    return _json(verificarNoChatwoot(p.fone || p.telefone || ''));
  }
  // Dispara o template no número, para descobrir qual responde
  if (acao === 'disparar') {
    var forcar = String(p.forcar || '') === '1' || String(p.forcar || '') === 'true';
    return _json(dispararAtendimento(p.fone || p.telefone || '', p.nome || '', forcar));
  }
  // Diagnóstico: quais caixas de entrada existem
  if (acao === 'inboxes') {
    return _json(listarInboxes());
  }

  /* Diagnóstico do que ESTÁ NO AR. O editor mostra o código que você está
     vendo; a implantação pode estar rodando outro, e as Propriedades do
     script pertencem ao projeto — não ao arquivo aberto. Já perdemos tempo
     com propriedade cadastrada no projeto errado, então esta rota responde
     pela implantação: qual código ela roda e quais tokens ela enxerga.
     Nunca devolve o token, só se existe e o tamanho. */
  if (acao === 'diag') {
    var g = ghostToken(), c = chatwootToken();
    return _json({
      ok: true,
      versaoDoCodigo: VERSAO_CODIGO,
      ghostTokenCadastrado: !!g,
      ghostTokenTamanho: g ? String(g).length : 0,
      chatwootTokenCadastrado: !!c,
      propriedadesExistentes: Object.keys(
        PropertiesService.getScriptProperties().getProperties() || {})
    });
  }

  if (acao !== 'vendas') {
    return _json({ ok: true, servico: 'LiveOps · Vendas e Comprovantes' });
  }
  try {
    // A planilha tem uma aba por mês ("AGOSTO 2026"). Sem pedido explícito,
    // vale a do mês corrente — senão a tela ficaria presa em agosto para
    // sempre quando setembro começasse.
    var aba = p.aba ? SpreadsheetApp.openById(PLANILHA_ID).getSheetByName(p.aba)
                    : abaDoMes(p.mes || '');
    if (!aba) return _json({ ok: false, erro: 'Aba de vendas não encontrada',
                             abas: listarAbas() });

    var ultLinha = aba.getLastRow(), ultCol = aba.getLastColumn();
    if (ultLinha < 1 || ultCol < 1) return _json({ ok: true, colunas: [], linhas: [] });

    var tudo = aba.getRange(1, 1, ultLinha, ultCol).getDisplayValues();
    var colunas = tudo.shift() || [];

    // Linha totalmente vazia não vira registro
    var linhas = tudo.filter(function (l) {
      return l.some(function (c) { return String(c || '').trim() !== ''; });
    });

    return _json({ ok: true, aba: aba.getName(), abas: listarAbas(),
                   colunas: colunas, linhas: linhas, total: linhas.length });
  } catch (err) {
    console.error(err);
    return _json({ ok: false, erro: String(err) });
  }
}

function listarAbas() {
  if (!PLANILHA_ID) return [];
  return SpreadsheetApp.openById(PLANILHA_ID).getSheets().map(function (a) { return a.getName(); });
}

/**
 * A aba do mês pedido (AAAA-MM). Sem mês, usa o de hoje. Não encontrando,
 * cai para o gid configurado e, por último, para a primeira aba — é melhor
 * mostrar algo do que uma tela vazia.
 */
function abaDoMes(mes) {
  if (!PLANILHA_ID) return null;
  var pl = SpreadsheetApp.openById(PLANILHA_ID);
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    var h = new Date();
    mes = h.getFullYear() + '-' + ('0' + (h.getMonth() + 1)).slice(-2);
  }
  var aceitos = nomesAceitosDoMes(mes);
  var abas = pl.getSheets();
  for (var i = 0; i < abas.length; i++) {
    if (aceitos[normalizar(abas[i].getName())]) return abas[i];
  }
  return abaDeVendas();
}

// Acha a aba pelo gid (o número no fim da URL da planilha) ou pelo nome
function abaDeVendas() {
  if (!PLANILHA_ID) return null;
  var pl = SpreadsheetApp.openById(PLANILHA_ID);
  if (GID_VENDAS !== null && GID_VENDAS !== undefined) {
    var abas = pl.getSheets();
    for (var i = 0; i < abas.length; i++) {
      if (abas[i].getSheetId() === GID_VENDAS) return abas[i];
    }
  }
  if (ABA_VENDAS) return pl.getSheetByName(ABA_VENDAS);
  return pl.getSheets()[0];
}

// ─────────────────────────────────────────────────────────────
// CHATWOOT — de quem é o telefone
// ─────────────────────────────────────────────────────────────
/**
 * Responde uma pergunta só: este número já conversou com a gente?
 *
 * A prova forte é a mensagem que o cliente MANDOU (message_type 0, entrada).
 * Se ele escreveu daquele número, o número é dele — não há como falsificar
 * isso do nosso lado, e não custa uma mensagem sequer. Mensagem que nós
 * enviamos não prova nada: dá para mandar para qualquer número errado.
 *
 * Por isso a verificação é de leitura pura. Disparar mensagem para número não
 * confirmado, só para ver se responde, é o caminho curto para o WhatsApp
 * marcar a conta como spam.
 */
function verificarNoChatwoot(fone) {
  if (!chatwootPronto()) {
    return { ok: false, erro: 'Chatwoot sem token — cadastre CHATWOOT_TOKEN nas Propriedades do script' };
  }
  var num = String(fone || '').replace(/\D/g, '');
  if (num.length < 10) return { ok: false, erro: 'Telefone inválido' };

  try {
    var contato = null;
    var variantes = variacoesDeTelefone(num);
    for (var i = 0; i < variantes.length && !contato; i++) {
      contato = buscarContatoChatwoot(variantes[i]);
    }
    if (!contato) {
      return { ok: true, achou: false, testados: variantes,
               resumo: 'Nenhum contato com este número no Chatwoot' };
    }

    var conversas = _chatwoot('/contacts/' + contato.id + '/conversations');
    var lista = (conversas && (conversas.payload || conversas.data && conversas.data.payload)) || [];
    var entradas = 0, ultimaEntrada = 0, idConversa = 0;
    lista.forEach(function (c) {
      var msgs = _chatwoot('/conversations/' + c.id + '/messages');
      var mm = (msgs && (msgs.payload || msgs)) || [];
      mm.forEach(function (m) {
        if (m && m.message_type === 0) {            // 0 = mensagem recebida
          entradas++;
          var ts = Number(m.created_at || 0);
          if (ts > ultimaEntrada) { ultimaEntrada = ts; idConversa = c.id; }
        }
      });
    });

    return {
      ok: true, achou: true,
      contatoId: contato.id,
      nome: contato.name || '',
      telefone: contato.phone_number || '',
      // O que decide a confirmação: houve mensagem VINDA deste número
      recebemosMensagem: entradas > 0,
      qtdRecebidas: entradas,
      ultimaEntrada: ultimaEntrada ? new Date(ultimaEntrada * 1000).toISOString() : '',
      link: CHATWOOT_URL + '/app/accounts/' + CHATWOOT_ACCOUNT_ID +
            (idConversa ? ('/conversations/' + idConversa) : ('/contacts/' + contato.id)),
      resumo: entradas > 0
        ? ('O cliente escreveu ' + entradas + ' vez(es) deste número')
        : 'Contato existe, mas nunca escreveu deste número'
    };
  } catch (err) {
    console.error(err);
    return { ok: false, erro: String(err) };
  }
}

/* O mesmo celular aparece escrito de várias formas: com e sem +55, com e sem
   o nono dígito. Procurar de um jeito só é não achar. */
function variacoesDeTelefone(num) {
  var so = String(num).replace(/\D/g, '').replace(/^55/, '');
  var ddd = so.slice(0, 2), resto = so.slice(2);
  var restos = [resto];
  if (resto.length === 9 && resto.charAt(0) === '9') restos.push(resto.slice(1));
  if (resto.length === 8) restos.push('9' + resto);
  var saida = [];
  restos.forEach(function (r) {
    saida.push('+55' + ddd + r);
    saida.push('55' + ddd + r);
    saida.push(ddd + r);
  });
  return saida;
}

function buscarContatoChatwoot(consulta) {
  var r = _chatwoot('/contacts/search?q=' + encodeURIComponent(consulta));
  var lista = (r && (r.payload || (r.data && r.data.payload))) || [];
  var alvo = String(consulta).replace(/\D/g, '').replace(/^55/, '');
  for (var i = 0; i < lista.length; i++) {
    var tel = String(lista[i].phone_number || '').replace(/\D/g, '').replace(/^55/, '');
    if (tel && tel === alvo) return lista[i];
  }
  return null;
}

function chatwootPronto() {
  return !!(CHATWOOT_URL && CHATWOOT_ACCOUNT_ID && chatwootToken());
}

/**
 * Manda o comando que dispara o template aprovado para um número, criando o
 * contato e a conversa se ainda não existirem. É o mesmo caminho que o
 * atendente faz na mão hoje ao digitar "/iniciar_atendimento".
 *
 * Duas travas que não são frescura:
 *   · só celular — template em telefone fixo é mensagem que nunca chega;
 *   · nada de reenviar para quem já recebeu nas últimas 24h. Sem isso, cada
 *     reconsulta do CPF viraria uma nova rajada para as mesmas pessoas, e é
 *     assim que a conta do WhatsApp perde qualidade e cai.
 */
function dispararAtendimento(fone, nome, forcar) {
  if (!chatwootPronto()) {
    return { ok: false, erro: 'Chatwoot sem token — cadastre CHATWOOT_TOKEN nas Propriedades do script' };
  }
  var num = String(fone || '').replace(/\D/g, '').replace(/^55/, '');
  if (num.length < 10) return { ok: false, erro: 'Telefone inválido' };
  var local = num.slice(2);
  if (!(local.length === 9 && local.charAt(0) === '9')) {
    return { ok: false, pulou: true, motivo: 'Não é celular — o template não chega em telefone fixo' };
  }
  var e164 = '+55' + num;

  try {
    var inbox = inboxDoWhatsApp();
    if (!inbox) return { ok: false, erro: 'Nenhuma caixa de WhatsApp encontrada no Chatwoot' };

    var contato = buscarContatoChatwoot(e164) || criarContato(e164, nome);
    if (!contato) return { ok: false, erro: 'Não foi possível criar o contato' };

    var conversa = conversaAberta(contato.id, inbox.id);
    /* "forcar" é o recomeço pedido pela tela: a ficha foi excluída e o CPF
       consultado de novo, então do lado de cá não existe mais registro de
       envio e o atendimento tem que sair outra vez. A trava das 24h continua
       para o caminho normal — ela existe para reconsulta do mesmo cliente não
       virar uma nova rajada, não para impedir um recomeço deliberado. */
    if (conversa && !forcar && jaDisparouRecente(conversa.id)) {
      return { ok: true, jaEnviado: true, conversaId: conversa.id,
               link: linkConversa(conversa.id),
               resumo: 'Já enviamos para este número nas últimas 24h — aguardando resposta' };
    }
    if (!conversa) conversa = criarConversa(contato, inbox.id, e164);
    if (!conversa) return { ok: false, erro: 'Não foi possível abrir a conversa' };

    _chatwootPost('/conversations/' + conversa.id + '/messages', {
      content: CHATWOOT_COMANDO,
      message_type: 'outgoing'
    });

    return { ok: true, enviado: true, contatoId: contato.id, conversaId: conversa.id,
             link: linkConversa(conversa.id), telefone: e164,
             resumo: 'Template disparado — aguardando resposta' };
  } catch (err) {
    console.error(err);
    return { ok: false, erro: String(err) };
  }
}

function linkConversa(id) {
  return CHATWOOT_URL + '/app/accounts/' + CHATWOOT_ACCOUNT_ID + '/conversations/' + id;
}

// A caixa configurada, ou a primeira de WhatsApp que existir
function inboxDoWhatsApp() {
  var r = _chatwoot('/inboxes');
  var lista = (r && (r.payload || r.data)) || [];
  if (CHATWOOT_INBOX_ID) {
    for (var i = 0; i < lista.length; i++) {
      if (String(lista[i].id) === String(CHATWOOT_INBOX_ID)) return lista[i];
    }
  }
  for (var j = 0; j < lista.length; j++) {
    var tipo = String(lista[j].channel_type || '');
    if (/whatsapp/i.test(tipo) || /whatsapp/i.test(String(lista[j].name || ''))) return lista[j];
  }
  return lista[0] || null;
}

function listarInboxes() {
  if (!chatwootPronto()) return { ok: false, erro: 'Chatwoot sem token' };
  try {
    var r = _chatwoot('/inboxes');
    var lista = (r && (r.payload || r.data)) || [];
    return { ok: true, inboxes: lista.map(function (i) {
      return { id: i.id, nome: i.name, canal: i.channel_type };
    }) };
  } catch (err) { return { ok: false, erro: String(err) }; }
}

function criarContato(e164, nome) {
  var r = _chatwootPost('/contacts', {
    name: nome || e164,
    phone_number: e164,
    inbox_id: (inboxDoWhatsApp() || {}).id
  });
  return (r && (r.payload && (r.payload.contact || r.payload))) || null;
}

function conversaAberta(contatoId, inboxId) {
  var r = _chatwoot('/contacts/' + contatoId + '/conversations');
  var lista = (r && (r.payload || (r.data && r.data.payload))) || [];
  for (var i = 0; i < lista.length; i++) {
    if (String(lista[i].inbox_id) === String(inboxId)) return lista[i];
  }
  return lista[0] || null;
}

function criarConversa(contato, inboxId, e164) {
  var r = _chatwootPost('/conversations', {
    source_id: contato.source_id || e164,
    inbox_id: inboxId,
    contact_id: contato.id
  });
  return (r && (r.id ? r : (r.payload || null))) || null;
}

// Já mandamos o comando para esta conversa nas últimas 24h?
function jaDisparouRecente(conversaId) {
  var r = _chatwoot('/conversations/' + conversaId + '/messages');
  var msgs = (r && (r.payload || r)) || [];
  var limite = (Date.now() / 1000) - 24 * 3600;
  for (var i = 0; i < msgs.length; i++) {
    var m = msgs[i];
    if (m && m.message_type === 1 && Number(m.created_at || 0) > limite) return true;
  }
  return false;
}

function _chatwootPost(caminho, corpo) {
  var url = CHATWOOT_URL + '/api/v1/accounts/' + CHATWOOT_ACCOUNT_ID + caminho;
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(corpo),
    muteHttpExceptions: true,
    headers: { 'api_access_token': chatwootToken() }
  });
  var codigo = resp.getResponseCode();
  if (codigo >= 400) {
    throw new Error('Chatwoot respondeu HTTP ' + codigo + ' em ' + caminho + ': ' +
                    resp.getContentText().slice(0, 200));
  }
  try { return JSON.parse(resp.getContentText()); } catch (err) { return {}; }
}

function _chatwoot(caminho) {
  var url = CHATWOOT_URL + '/api/v1/accounts/' + CHATWOOT_ACCOUNT_ID + caminho;
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: { 'api_access_token': chatwootToken() }
  });
  var codigo = resp.getResponseCode();
  if (codigo === 401 || codigo === 403) throw new Error('Chatwoot recusou o token (HTTP ' + codigo + ')');
  if (codigo >= 400) throw new Error('Chatwoot respondeu HTTP ' + codigo + ' em ' + caminho);
  try { return JSON.parse(resp.getContentText()); }
  catch (err) { throw new Error('Resposta do Chatwoot não é JSON: ' + resp.getContentText().slice(0, 200)); }
}

// ─────────────────────────────────────────────────────────────
// COMPROVANTE → pasta do mês
// ─────────────────────────────────────────────────────────────
function salvarComprovante(d) {
  if (!d.fileBase64) return { ok: false, erro: 'Sem arquivo' };

  // "2026-08" vem do sistema; se não vier, sai da data da venda
  var mes = String(d.mes || '').slice(0, 7) || String(d.data || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) return { ok: false, erro: 'Mês inválido: ' + mes };

  var pasta = pastaDoMes(mes);

  // Nome no padrão pedido: "16.08 - 35353535"
  var nome = String(d.fileName || '').trim();
  if (!nome) {
    var iso = String(d.data || '');
    nome = iso.slice(8, 10) + '.' + iso.slice(5, 7) + ' - ' + String(d.numPedido || '');
  }
  nome = nome.replace(/[\\/:*?"<>|]/g, '-');          // proibidos no Drive
  nome = nome + extensaoDe(d.mimeType);

  // Já existe um arquivo com esse nome? Guarda os dois, com sufixo. Nunca
  // sobrescreve: comprovante é documento, não rascunho.
  var final = nome, n = 2;
  while (pasta.getFilesByName(final).hasNext()) {
    final = nome.replace(/(\.[^.]+)?$/, ' (' + n + ')$1');
    n++;
  }

  var bytes = Utilities.base64Decode(d.fileBase64);
  var blob  = Utilities.newBlob(bytes, d.mimeType || 'image/jpeg', final);
  var arq   = pasta.createFile(blob);

  return { ok: true, arquivo: arq.getName(), pasta: pasta.getName(), id: arq.getId() };
}

/**
 * Encontra a pasta do mês dentro de "Comprovantes". Aceita os formatos que
 * costumam aparecer aí (08.2026, 08-2026, 08/2026, AGOSTO, AGOSTO 2026,
 * 2026-08). Não achando nenhuma, cria "08.2026" — assim nada se perde por
 * causa de um nome escrito de um jeito diferente.
 */
/**
 * Os nomes que valem como "este mês" — serve para a pasta do Drive e para a
 * aba da planilha, que também é uma por mês ("AGOSTO 2026").
 */
var MESES_PT = ['','JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO',
                'JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];

function nomesAceitosDoMes(mes) {
  var ano = mes.slice(0, 4), mm = mes.slice(5, 7);
  var nomeMes = MESES_PT[parseInt(mm, 10)];
  var aceitos = {};
  [ mm + '.' + ano, mm + '-' + ano, mm + '/' + ano, mm + ' ' + ano,
    ano + '-' + mm, ano + '.' + mm, ano + '/' + mm,
    nomeMes, nomeMes + ' ' + ano, nomeMes + '/' + ano, nomeMes + '.' + ano,
    nomeMes + ' DE ' + ano
  ].forEach(function (c) { aceitos[normalizar(c)] = true; });
  return aceitos;
}

/**
 * Além dos nomes exatos, reconhece a pasta pelo conteúdo do nome: quem
 * organiza o Drive escreve "08/2026 (AGO)", "AGO 2026", "Agosto 2026 -
 * comprovantes". Exigir nome exato fazia o script criar uma pasta paralela e
 * o comprovante sumir de vista, mesmo estando salvo.
 * Só vale se o ANO bater — assim "AGOSTO 2025" nunca recebe venda de 2026.
 */
function pastaCombinaComMes(nomePasta, mes) {
  var ano = mes.slice(0, 4), mm = mes.slice(5, 7);
  var nomeMes = MESES_PT[parseInt(mm, 10)];
  var n = normalizar(nomePasta);
  if (nomesAceitosDoMes(mes)[n]) return true;
  if (n.indexOf(ano) < 0) return false;
  // Mês por extenso, abreviado (AGO) ou pelo número colado ao ano (082026 / 202608)
  return n.indexOf(nomeMes) >= 0
      || n.indexOf(nomeMes.slice(0, 3)) >= 0
      || n.indexOf(mm + ano) >= 0
      || n.indexOf(ano + mm) >= 0;
}

// Quantos arquivos a pasta tem — para escolher a que está realmente em uso
function _qtdArquivos(pasta) {
  var n = 0, it = pasta.getFiles();
  while (it.hasNext()) { it.next(); n++; if (n > 500) break; }
  return n;
}

function pastaDoMes(mes) {
  var raiz = DriveApp.getFolderById(PASTA_COMPROVANTES_ID);
  var ano  = mes.slice(0, 4);
  var mm   = mes.slice(5, 7);

  // Pode haver mais de uma pasta do mesmo mês (uma escrita por pessoa, outra
  // criada por engano pelo próprio script). Escolher "a primeira que aparecer"
  // é sorteio: o comprovante ora cai numa, ora noutra. Vale a que já tem
  // comprovantes dentro — é a que a equipe abre.
  var candidatas = [];
  var pastas = raiz.getFolders();
  while (pastas.hasNext()) {
    var p = pastas.next();
    if (pastaCombinaComMes(p.getName(), mes)) candidatas.push(p);
  }
  if (candidatas.length === 1) return candidatas[0];
  if (candidatas.length > 1) {
    var melhor = candidatas[0], melhorQtd = -1;
    candidatas.forEach(function (c) {
      var q = _qtdArquivos(c);
      if (q > melhorQtd) { melhorQtd = q; melhor = c; }
    });
    console.warn('Mais de uma pasta para ' + mes + ': ' +
      candidatas.map(function (c) { return c.getName(); }).join(' | ') +
      ' — usando "' + melhor.getName() + '". Junte as pastas para não dividir os comprovantes.');
    return melhor;
  }
  return raiz.createFolder(mm + '.' + ano);
}

// Tira acento, espaço e pontuação para comparar nomes de pasta
function normalizar(txt) {
  return String(txt || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function extensaoDe(mime) {
  var m = String(mime || '').toLowerCase();
  if (m.indexOf('png')  >= 0) return '.png';
  if (m.indexOf('webp') >= 0) return '.webp';
  if (m.indexOf('pdf')  >= 0) return '.pdf';
  return '.jpg';
}

// ─────────────────────────────────────────────────────────────
// PLANILHA DE VENDAS
// ─────────────────────────────────────────────────────────────
/**
 * Grava a venda na aba do mês. A planilha é conferida por pessoas, então o
 * script só encosta nas colunas que ele mesmo produz:
 *
 *   Data Venda · N° Pedido · Valor Recebido (R$) · Origem Recebimento
 *
 * "Valor Cotação Dolar", "Valor Dolar" e "Conferência Socios" ficam de fora:
 * a primeira é digitada à mão, a segunda tem fórmula própria e a terceira é
 * a marcação manual dos sócios. As colunas são achadas pelo NOME do
 * cabeçalho — mudar a ordem delas na planilha não desalinha mais nada.
 */
function COLUNAS_VENDA() {
  return {
    data:   ['data venda', 'data'],
    pedido: ['n° pedido', 'no pedido', 'nº pedido', 'numero do pedido', 'n pedido', 'pedido'],
    valor:  ['valor recebido (r$)', 'valor recebido', 'valor'],
    origem: ['origem recebimento', 'origem do recebimento', 'origem']
  };
}

// "N° Pedido" e "no pedido" viram a mesma coisa: só letras e números, maiúsculo
function _normalizarCabecalho(t) {
  return normalizar(String(t || ''));
}

// Devolve {data:1, pedido:2, ...} com o número da coluna de cada campo
function _mapaDeColunas(aba) {
  var ultCol = Math.max(aba.getLastColumn(), 1);
  var cabecalho = aba.getRange(1, 1, 1, ultCol).getValues()[0] || [];
  var alvos = COLUNAS_VENDA(), mapa = {};
  Object.keys(alvos).forEach(function (campo) {
    for (var c = 0; c < cabecalho.length; c++) {
      var titulo = _normalizarCabecalho(cabecalho[c]);
      var bate = alvos[campo].some(function (a) { return normalizar(a) === titulo; });
      if (bate) { mapa[campo] = c + 1; break; }
    }
  });
  return mapa;
}

// "2026-08-14" → data de verdade, ao meio-dia (fuso não empurra para o dia anterior)
function _dataDaVenda(iso) {
  var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

function gravarNaPlanilha(acao, d) {
  if (!PLANILHA_ID) return { ok: true, aviso: 'Planilha não configurada — nada gravado' };

  // A venda entra na aba do mês dela, não numa aba fixa
  var aba = abaDoMes(String(d.data || '').slice(0, 7));
  if (!aba) return { ok: false, erro: 'Aba de vendas não encontrada' };

  var col = _mapaDeColunas(aba);
  if (!col.data || !col.pedido || !col.valor) {
    return { ok: false, erro: 'Cabeçalho da aba "' + aba.getName() + '" não tem Data Venda / N° Pedido / Valor Recebido' };
  }

  // A linha é achada pelo número do pedido — é o que identifica a venda para
  // quem lê a planilha. Na edição, o número antigo é quem procura.
  var procurado = String((acao === 'editar' && d.numPedidoAntigo) ? d.numPedidoAntigo : d.numPedido || '').trim();
  var ultLinha = aba.getLastRow();
  var linha = -1;
  if (procurado && ultLinha > 1) {
    var col_ped = aba.getRange(2, col.pedido, ultLinha - 1, 1).getDisplayValues();
    for (var i = 0; i < col_ped.length; i++) {
      if (String(col_ped[i][0]).trim() === procurado) { linha = i + 2; break; }
    }
  }

  if (acao === 'excluir') {
    if (linha > 0) aba.deleteRow(linha);
    return { ok: true, acao: 'excluir', linha: linha };
  }

  var nova = false;
  if (linha < 0) { linha = Math.max(ultLinha, 1) + 1; nova = true; }

  var dataVenda = _dataDaVenda(d.data);
  if (dataVenda) {
    var celData = aba.getRange(linha, col.data);
    celData.setValue(dataVenda);
    // Só define o formato em linha nova: em linha existente, respeita o que já está lá
    if (nova) celData.setNumberFormat('dd/MM');
  }

  // O pedido é identificador, não valor: número puro entra como número sem
  // formato de moeda (foi assim que "46297969" virou "R$ 46.297.969,00");
  // qualquer outra coisa entra como texto, para não perder zero à esquerda.
  var ped = String(d.numPedido || '').trim();
  var celPed = aba.getRange(linha, col.pedido);
  if (/^[1-9]\d*$/.test(ped)) {
    if (nova) celPed.setNumberFormat('0');
    celPed.setValue(Number(ped));
  } else {
    if (nova) celPed.setNumberFormat('@');
    celPed.setValue(ped);
  }

  var celValor = aba.getRange(linha, col.valor);
  celValor.setValue(Number(d.valor || 0));
  if (nova) celValor.setNumberFormat('R$ #,##0.00');

  var avisos = [];
  if (col.origem) {
    // A venda traz a lista do sistema: forma criada lá passa a existir aqui
    // antes de a origem ser gravada, senão a primeira venda dela ficaria vazia
    if (d.formas && d.formas.length) {
      try { sincronizarFormas(d.formas, String(d.data || '').slice(0, 7)); }
      catch (err) { console.warn('Não foi possível sincronizar as formas: ' + err); }
    }
    var av = gravarOrigem(aba, linha, col.origem, d.formaPagamento || '');
    if (av) avisos.push(av);
  }

  return { ok: true, acao: nova ? 'criar' : (acao === 'editar' ? 'editar' : 'atualizar'),
           aba: aba.getName(), linha: linha,
           avisos: avisos.length ? avisos : undefined };
}

/**
 * A coluna "Origem Recebimento" tem lista de validação, e os nomes de lá não
 * são os do sistema: aqui é "Pix Manoel", lá é "Venda - Pix Manoel". Gravar o
 * texto cru viola a validação, o Apps Script lança erro e a gravação morre no
 * meio — foi por isso que a venda entrou com data, pedido e valor, mas sem a
 * origem.
 *
 * Então o valor da lista é escolhido por palavras: "C. de Crédito Merc. Pago"
 * casa com "Venda - C. Crédito Merc. Pago Suplelive" porque todas as palavras
 * que importam estão lá ("de", "venda" e afins não contam).
 */
var ORIGEM_PALAVRAS_IGNORADAS = { VENDA: 1, DE: 1, DA: 1, DO: 1, SUPLELIVE: 1, '': 1 };

// Cores dos chips, tiradas do próprio nome: venda no Pix verde, venda no
// cartão azul, compra cinza. Forma nova nasce colorida sem cadastrar cor.
var CORES_ORIGEM = [
  { teste: /^COMPRA/,          fundo: '#5f6368', texto: '#ffffff' },
  { teste: /CREDITO|CARTAO/,   fundo: '#1a73e8', texto: '#ffffff' },
  { teste: /./,                fundo: '#0f9d58', texto: '#ffffff' }
];

function corDaOrigem(nome) {
  var n = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  for (var i = 0; i < CORES_ORIGEM.length; i++) {
    if (CORES_ORIGEM[i].teste.test(n)) return CORES_ORIGEM[i];
  }
  return CORES_ORIGEM[CORES_ORIGEM.length - 1];
}

/**
 * Põe na planilha as formas de pagamento que existem no sistema: entram na
 * lista do dropdown da coluna "Origem Recebimento" e ganham a cor pela regra
 * acima. O que já existia na planilha é preservado — ninguém perde opção que
 * tenha criado direto lá.
 *
 * Roda em todas as abas de mês, senão o dropdown novo só valeria no mês
 * corrente e setembro nasceria sem as opções.
 */
function sincronizarFormas(formas, mes) {
  if (!PLANILHA_ID) return { ok: false, erro: 'Planilha não configurada' };
  formas = (formas || []).map(function (f) { return String(f || '').trim(); })
                         .filter(function (f) { return f; });
  if (!formas.length) return { ok: false, erro: 'Nenhuma forma recebida' };

  var abas = mes ? [abaDoMes(mes)] : SpreadsheetApp.openById(PLANILHA_ID).getSheets();
  var tocadas = [];
  abas.forEach(function (aba) {
    if (!aba) return;
    var col = _mapaDeColunas(aba);
    if (!col.origem) return;                     // aba que não é de vendas
    var atuais = opcoesDaColuna(aba, Math.max(aba.getLastRow(), 2), col.origem) || [];
    var lista = atuais.slice();
    formas.forEach(function (f) {
      var jaTem = lista.some(function (x) { return normalizar(x) === normalizar(f); });
      if (!jaTem) lista.push(f);
    });
    aplicarListaEcores(aba, col.origem, lista);
    tocadas.push(aba.getName() + ' (' + lista.length + ' opções)');
  });
  return { ok: true, acao: 'formas', abas: tocadas };
}

// Aplica a lista de validação na coluna inteira e recria as regras de cor
function aplicarListaEcores(aba, coluna, lista) {
  var ultima = Math.max(aba.getMaxRows(), 2);
  var faixa = aba.getRange(2, coluna, ultima - 1, 1);

  var regra = SpreadsheetApp.newDataValidation()
    .requireValueInList(lista, true)
    .setAllowInvalid(true)   // não recusa o que já estava escrito na planilha
    .build();
  faixa.setDataValidation(regra);

  // Uma regra de cor por opção. As antigas desta mesma coluna saem, para não
  // acumular regra repetida a cada sincronização.
  var a1 = faixa.getA1Notation();
  var mantidas = aba.getConditionalFormatRules().filter(function (r) {
    return !r.getRanges().some(function (rg) { return rg.getA1Notation() === a1; });
  });
  lista.forEach(function (op) {
    var cor = corDaOrigem(op);
    mantidas.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(op)
      .setBackground(cor.fundo)
      .setFontColor(cor.texto)
      .setRanges([faixa])
      .build());
  });
  aba.setConditionalFormatRules(mantidas);
}

function _palavrasDe(txt) {
  return String(txt || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ')
    .filter(function (p) { return !ORIGEM_PALAVRAS_IGNORADAS[p]; });
}

// Opções da lista de validação da célula (ou da linha de cima, se a nova ainda
// não herdou a regra). Sem lista, devolve null.
function opcoesDaColuna(aba, linha, coluna) {
  for (var l = linha; l >= 2; l--) {
    var regra = aba.getRange(l, coluna).getDataValidation();
    if (!regra) continue;
    if (regra.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return null;
    var args = regra.getCriteriaValues();
    if (args && args[0] && args[0].length) return args[0];
    return null;
  }
  return null;
}

function escolherOpcao(opcoes, valor) {
  var alvo = _palavrasDe(valor);
  if (!alvo.length) return null;
  var melhor = null, melhorNota = 0;
  opcoes.forEach(function (op) {
    var tem = _palavrasDe(op), achou = 0;
    alvo.forEach(function (p) { if (tem.indexOf(p) >= 0) achou++; });
    var nota = achou / alvo.length;
    // Empate: ganha a opção mais curta, que é a mais específica
    if (nota > melhorNota || (nota === melhorNota && melhor && nota > 0 && op.length < melhor.length)) {
      melhorNota = nota; melhor = op;
    }
  });
  return melhorNota === 1 ? melhor : null;
}

function gravarOrigem(aba, linha, coluna, valor) {
  if (!valor) return '';
  var cel = aba.getRange(linha, coluna);
  var opcoes = opcoesDaColuna(aba, linha, coluna);
  if (opcoes) {
    var escolhida = escolherOpcao(opcoes, valor);
    if (escolhida) { cel.setValue(escolhida); return ''; }
    // Nenhuma opção corresponde: não force nada na célula — a venda já está
    // gravada, e quem confere escolhe no dropdown sabendo o que faltou
    console.warn('Origem "' + valor + '" não existe na lista da planilha: ' + opcoes.join(' | '));
    return 'Origem "' + valor + '" não está na lista da planilha — preencher à mão';
  }
  try { cel.setValue(valor); } catch (err) {
    console.warn('Não foi possível gravar a origem: ' + err);
    return 'Origem não pôde ser gravada: ' + err;
  }
  return '';
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────
// TESTE — rode daqui mesmo, sem depender do sistema
// Apps Script → selecione "testarComprovante" → Executar.
// Deve criar um arquivo de teste na pasta do mês.
// ─────────────────────────────────────────────────────────────
function testarLeituraDaPlanilha() {
  var r = doGet({ parameter: { acao: 'vendas' } });
  Logger.log(r.getContent().slice(0, 800));
}

// Mostra em qual pasta o comprovante deste mês vai cair, e lista o que existe
// dentro de "Comprovantes" — serve para conferir sem criar arquivo nenhum.
function testarPastaDoMes() {
  var h = new Date();
  var mes = h.getFullYear() + '-' + ('0' + (h.getMonth() + 1)).slice(-2);
  var raiz = DriveApp.getFolderById(PASTA_COMPROVANTES_ID);
  var escolhida = pastaDoMes(mes);
  var todas = [], p = raiz.getFolders();
  while (p.hasNext()) {
    var f = p.next();
    todas.push(f.getName() + ' (' + _qtdArquivos(f) + ' arquivo(s))'
      + (f.getId() === escolhida.getId() ? '   <<< o comprovante vai para esta'
         : (pastaCombinaComMes(f.getName(), mes) ? '   (também é de ' + mes + ' — junte as duas)' : '')));
  }
  Logger.log('Mês: ' + mes + '\nPastas em "' + raiz.getName() + '":\n· ' + todas.join('\n· '));
}

/**
 * Grava uma venda de mentira exatamente como o sistema grava — mesmo caminho,
 * mesmo formato de dados. Serve para ver o erro: quando o LiveOps envia, a
 * resposta se perde (o POST vai em no-cors), então nada aparece na tela.
 * Aqui o erro aparece no log.
 *
 * A linha entra na aba do mês com o pedido 00000001. Depois de conferir,
 * apague a linha na mão.
 */
function testarGravarVenda() {
  var h = new Date();
  var hoje = h.getFullYear() + '-' + ('0' + (h.getMonth() + 1)).slice(-2) + '-' + ('0' + h.getDate()).slice(-2);
  var r = gravarNaPlanilha('criar', {
    numPedido: '00000001',
    valor: 123.45,
    formaPagamento: 'Pix Manoel',
    data: hoje,
    registradoPor: 'Teste'
  });
  Logger.log(JSON.stringify(r));

  // Mostra as opções que a coluna de origem aceita e qual seria escolhida
  var aba = abaDoMes(hoje.slice(0, 7));
  if (aba) {
    var col = _mapaDeColunas(aba);
    Logger.log('Colunas encontradas: ' + JSON.stringify(col));
    if (col.origem) {
      var ops = opcoesDaColuna(aba, Math.max(aba.getLastRow(), 2), col.origem);
      Logger.log('Opções da coluna Origem: ' + (ops ? ops.join(' | ') : '(coluna sem lista de validação)'));
      if (ops) {
        ['Pix Manoel', 'Pix Vix Comercio', 'Pix 4Vita',
         'C. de Crédito Infinity Pay', 'C. de Crédito Merc. Pago'].forEach(function (f) {
          Logger.log('  ' + f + '  ->  ' + (escolherOpcao(ops, f) || '(NENHUMA — preencher à mão)'));
        });
      }
    }
  }
}

/**
 * Confere a ligação com o Chatwoot sem depender do sistema. Troque o número
 * abaixo por um de cliente que você sabe que já conversou com a gente — o log
 * deve dizer quantas vezes ele escreveu.
 */
function testarChatwoot() {
  Logger.log('Token do Chatwoot cadastrado? ' + (chatwootToken() ? 'sim' : 'NÃO — cadastre nas Propriedades do script'));
  Logger.log('Token da GhostAPIs cadastrado? ' + (ghostToken() ? 'sim' : 'NÃO — a consulta de CPF vai falhar'));
  Logger.log('Caixas de entrada: ' + JSON.stringify(listarInboxes()));
  Logger.log('Verificação: ' + JSON.stringify(verificarNoChatwoot('27999887766'), null, 2));
}

/* Dispara o template para UM número, para conferir o caminho inteiro antes de
   usar na ficha. Troque pelo seu próprio celular. */
function testarDisparo() {
  Logger.log(JSON.stringify(dispararAtendimento('27999887766', 'Teste LiveOps'), null, 2));
}

function testarComprovante() {
  var r = salvarComprovante({
    numPedido: '35353535',
    data: '2026-08-16',
    mes: '2026-08',
    fileName: '16.08 - 35353535',
    mimeType: 'image/png',
    // PNG de 1 pixel
    fileBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  });
  Logger.log(r);
}
