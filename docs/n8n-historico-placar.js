// O placar da varredura: sabe o tamanho do alvo, entao da para conferir de
// olho se veio tudo — e nao ficar adivinhando se falta pagina.
let conversas = 0, mensagens = 0, total = 0, paginas = 0, contatos = 0, caixa = '';
try {
  const p = $('Paginas a varrer').all();
  paginas = p.length;
  total = Number(p[0].json.total || 0);
  caixa = p[0].json.caixaNome || '';
} catch (e) {}
try { $('Agrupar conversas').all().forEach(i => { conversas += (i.json.quantas || 0); }); } catch (e) {}
try { $('Converter mensagens').all().forEach(i => { mensagens += (i.json.quantas || 0); }); } catch (e) {}
try { $('Montar agenda').all().forEach(i => { contatos += (i.json.quantas || 0); }); } catch (e) {}

// Gravacao que falhou nao some: os nos estao em continueRegularOutput, entao
// o item segue com um campo de erro em vez de matar a varredura. Quem conta
// tem que olhar OS TRES nomes possiveis — n8n escreve 'error', o worker
// responde 'ok:false', e um erro nosso viria como 'erro'. Contar so 'erro'
// era o furo: 3.141 gravacoes com timeouts no meio fechavam com falhas: 0.
function contarFalhas(no) {
  let n = 0;
  try {
    $(no).all().forEach(i => {
      const j = i.json || {};
      if (j.ok === false || j.erro || j.error) n++;
    });
  } catch (e) {}
  return n;
}
// De propria conta, e nao do $input: assim as tres passagens do Placar
// (uma por ramo que chega nele) mostram o mesmo numero, o total.
const falhasConversas = contarFalhas('Gravar conversas no LiveOps');
const falhasMensagens = contarFalhas('Gravar mensagens no LiveOps');
const falhasContatos  = contarFalhas('Gravar contatos no LiveOps');
// A rodada que perdeu 1.292 conversas ensinou: a LEITURA tambem falha —
// pagina do Chatwoot que volta vazia some da varredura sem entrar em
// falha nenhuma. Conta-se aqui, separada das gravacoes.
const falhasLeituraPaginas   = contarFalhas('Listar conversas');
const falhasLeituraMensagens = contarFalhas('Listar mensagens');
const falhas = falhasConversas + falhasMensagens + falhasContatos
             + falhasLeituraPaginas + falhasLeituraMensagens;

let cortou = false, bloco = false;
try {
  const cfg = $('Resolver caixa').first().json;
  cortou = !!cfg.corte;                 // com corte por data, vir menos e o esperado
  bloco = cfg.paginasMax > 0 || cfg.paginaInicial > 1;
} catch (e) {}
const faltou = total && !cortou && !bloco && conversas < total - 5;

let proxima = 0, ultimaPagina = 0;
try {
  const p = $('Paginas a varrer').all();
  ultimaPagina = Number(p[0].json.ultimaPagina || 0);
  proxima = Number(p[p.length - 1].json.pagina || 0) + 1;
} catch (e) {}
const acabou = ultimaPagina && proxima > ultimaPagina;

const aviso = falhas
  ? (' ATENCAO: ' + falhas + ' chamada(s) falharam ('
     + [falhasLeituraPaginas ? falhasLeituraPaginas + ' paginas nao lidas' : '',
        falhasLeituraMensagens ? falhasLeituraMensagens + ' conversas sem leitura de mensagens' : '',
        falhasConversas ? falhasConversas + ' gravacoes de conversa' : '',
        falhasMensagens ? falhasMensagens + ' gravacoes de mensagem' : '',
        falhasContatos  ? falhasContatos  + ' gravacoes de contato'  : ''].filter(Boolean).join(', ')
     + '). Rode de novo: regravar sobrescreve o mesmo registro, nao duplica.')
  : '';

return [{ json: {
  caixa,
  totalNoChatwoot: total,
  paginasVarridas: paginas,
  conversas,
  contatos,
  mensagens,
  falhas,
  falhasConversas, falhasMensagens, falhasContatos,
  falhasLeituraPaginas, falhasLeituraMensagens,
  recado: (!conversas
    ? 'Nenhuma conversa voltou — confira a credencial do Chatwoot.'
    : (faltou
      ? ('Vieram ' + conversas + ' de ' + total + ' conversas. Faltou gente: rode de novo, '
         + 'ou quebre em blocos com PAGINA_INICIAL / PAGINAS_MAX no no "Resolver caixa".')
      : ((bloco ? 'Bloco concluido' : 'Varredura completa') + ' da caixa "' + caixa + '": '
         + conversas + ' conversa(s) de ' + total + ', ' + contatos
         + ' contato(s) na agenda e ' + mensagens + ' mensagem(ns). '
         + (!bloco ? (falhas ? '' : 'Nao precisa rodar de novo.')
            : (acabou ? 'Era o ultimo bloco — acabou aqui.'
                      : ('Proximo bloco: PAGINA_INICIAL = ' + proxima + ' (de ' + ultimaPagina + ').')))))) + aviso,
} }];
