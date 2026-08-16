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

// Pasta "Comprovantes" no Drive — a que tem as pastas de cada mês dentro
var PASTA_COMPROVANTES_ID = '1H6rq8v0ZHJfcgp3QTAnKWYrPQJfQoTsr';

// Planilha "Registro de Vendas WhatsApp"
var PLANILHA_ID  = '15aF5lcOi2Xg7iKuhsfcmxPALLUKHEqg5HRm7jmiAzhY';
// A aba é escolhida pelo gid da URL da planilha (…#gid=1231262605). Deixando
// GID_VENDAS em null, usa a primeira aba.
var GID_VENDAS   = 1231262605;
var ABA_VENDAS   = '';   // alternativa ao gid: o nome da aba

// Token da GhostAPIs, usado só pela consulta de CPF
var GHOST_TOKEN  = 'f8ee18bc4b133d6d7e2a6dc9cf62eb2b';

// ─────────────────────────────────────────────────────────────
// ENTRADA
// ─────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    var corpo = (e && e.postData && e.postData.contents) || '{}';
    var d = JSON.parse(corpo);
    var acao = String(d.acao || '');

    if (acao === 'comprovante') return _json(salvarComprovante(d));
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
    try {
      var resp = UrlFetchApp.fetch(
        'https://ghostapis.com/api.php?token=' + GHOST_TOKEN + '&cpf_simples=' + cpf,
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
function nomesAceitosDoMes(mes) {
  var ano = mes.slice(0, 4), mm = mes.slice(5, 7);
  var nomeMes = ['','JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO',
                 'JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'][parseInt(mm, 10)];
  var aceitos = {};
  [ mm + '.' + ano, mm + '-' + ano, mm + '/' + ano, mm + ' ' + ano,
    ano + '-' + mm, ano + '.' + mm, ano + '/' + mm,
    nomeMes, nomeMes + ' ' + ano, nomeMes + '/' + ano, nomeMes + '.' + ano,
    nomeMes + ' DE ' + ano
  ].forEach(function (c) { aceitos[normalizar(c)] = true; });
  return aceitos;
}

function pastaDoMes(mes) {
  var raiz = DriveApp.getFolderById(PASTA_COMPROVANTES_ID);
  var ano  = mes.slice(0, 4);
  var mm   = mes.slice(5, 7);

  var aceitos = nomesAceitosDoMes(mes);

  var pastas = raiz.getFolders();
  while (pastas.hasNext()) {
    var p = pastas.next();
    if (aceitos[normalizar(p.getName())]) return p;
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

  if (col.origem) aba.getRange(linha, col.origem).setValue(d.formaPagamento || '');

  return { ok: true, acao: nova ? 'criar' : (acao === 'editar' ? 'editar' : 'atualizar'),
           aba: aba.getName(), linha: linha };
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
