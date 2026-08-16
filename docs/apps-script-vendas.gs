/**
 * LiveOps — Registro de Vendas + Comprovantes
 *
 * ATENÇÃO: este NÃO é o script do proxy de CPF.
 * São duas implantações diferentes:
 *   · CPF        → .../AKfycbwVAjVS...  (o código com doGet e GHOST_TOKEN)
 *   · Vendas     → .../AKfycbzpMlENHS...  ← é ESTE aqui
 * Não cole este código por cima do proxy de CPF: as duas coisas param.
 *
 * O que este script faz:
 *   acao 'criar' | 'editar' | 'excluir'  → mantém a planilha de vendas
 *   acao 'comprovante'                   → salva o print na pasta do MÊS,
 *                                          com o nome "DD.MM - Nº do pedido"
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

// Planilha de vendas. Deixe '' para não mexer em planilha nenhuma.
var PLANILHA_ID  = '';
var ABA_VENDAS   = 'Vendas';

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

// Serve para testar no navegador: abra a URL /exec e veja se responde
function doGet() {
  return _json({ ok: true, servico: 'LiveOps · Vendas e Comprovantes' });
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
function pastaDoMes(mes) {
  var raiz = DriveApp.getFolderById(PASTA_COMPROVANTES_ID);
  var ano  = mes.slice(0, 4);
  var mm   = mes.slice(5, 7);
  var nomeMes = ['','JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO',
                 'JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'][parseInt(mm, 10)];

  var aceitos = {};
  [ mm + '.' + ano, mm + '-' + ano, mm + '/' + ano, mm + ' ' + ano,
    ano + '-' + mm, ano + '.' + mm, ano + '/' + mm,
    nomeMes, nomeMes + ' ' + ano, nomeMes + '/' + ano, nomeMes + '.' + ano,
    nomeMes + ' DE ' + ano
  ].forEach(function (c) { aceitos[normalizar(c)] = true; });

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
function gravarNaPlanilha(acao, d) {
  if (!PLANILHA_ID) return { ok: true, aviso: 'Planilha não configurada — nada gravado' };

  var aba = SpreadsheetApp.openById(PLANILHA_ID).getSheetByName(ABA_VENDAS);
  if (!aba) return { ok: false, erro: 'Aba não encontrada: ' + ABA_VENDAS };

  // Coluna A guarda o id do pedido: é por ele que editar e excluir acham a linha
  var ids = aba.getRange(1, 1, Math.max(aba.getLastRow(), 1), 1).getValues();
  var linha = -1;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(d.id)) { linha = i + 1; break; }
  }

  if (acao === 'excluir') {
    if (linha > 0) aba.deleteRow(linha);
    return { ok: true, acao: 'excluir', linha: linha };
  }

  var valores = [
    d.id || '',
    d.data || '',
    d.hora || '',
    d.numPedido || '',
    Number(d.valor || 0),
    d.formaPagamento || '',
    d.registradoPor || ''
  ];

  if (acao === 'editar' && linha > 0) {
    aba.getRange(linha, 1, 1, valores.length).setValues([valores]);
    return { ok: true, acao: 'editar', linha: linha };
  }
  aba.appendRow(valores);
  return { ok: true, acao: 'criar', linha: aba.getLastRow() };
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
