// Cada conversa do Chatwoot vira DUAS coisas: o registro que o WhatsLive
// desenha na caixa e o contato que vai para a agenda. O formato e o mesmo
// do fluxo ao vivo, para historico e mensagem nova ficarem indistinguiveis.
//
// A configuracao vem do "Resolver caixa", NAO do item: a saida de um no
// HTTP substitui o json pela resposta do Chatwoot, e a primeira versao
// deste codigo lia mapaCaixas do item — que ja nao existia. Resultado:
// TODO contato e TODA conversa da varredura entraram sem caixa, e as
// vistas Cliente Antigo/Oficial abriram zeradas com o banco cheio.
const cfg0 = $('Resolver caixa').first().json;
const caixas = cfg0.mapaCaixas || {};
const corte = Number(cfg0.corte || 0);
const trazer = cfg0.trazerMensagens !== false;

const saida = [];
for (const item of $input.all()) {
  const r = item.json || {};
  const lista = (r.data && r.data.payload) || r.payload || [];

  for (const c of lista) {
    const num = c.id;                    // display_id da conversa
    if (!num) continue;

    let criada = Number(c.created_at || 0);
    if (criada && criada < 1e12) criada = criada * 1000;
    // O mesmo "Criado em / e menos que" da tela do Chatwoot, feito aqui
    // porque o endpoint de listagem nao aceita filtro de data.
    if (corte && criada && criada >= corte) continue;

    const contato = (c.meta && c.meta.sender) || {};
    const ultima = c.last_non_activity_message || {};
    const mtU = ultima.message_type;
    const deU = ultima.private === true ? 'nota'
              : (mtU === 1 || mtU === 3 || mtU === 'outgoing' || mtU === 'template') ? 'agente'
              : 'cliente';
    let ts = (c.timestamp || c.last_activity_at || ultima.created_at || 0);
    if (ts && ts < 1e12) ts = ts * 1000;
    let texto = String(ultima.content || '').trim();
    if (!texto && Array.isArray(ultima.attachments) && ultima.attachments.length) {
      const tipos = { image: 'imagem', audio: 'audio', video: 'video', file: 'arquivo' };
      texto = '[' + (tipos[ultima.attachments[0].file_type] || 'anexo') + ']';
    }

    // A caixa "2. Antigo" e um canal da Evolution: por la o contato as
    // vezes chega sem phone_number, com o numero no identifier
    // ('5527...@s.whatsapp.net'). Telefone e a chave da agenda inteira.
    let tel = String(contato.phone_number || '').trim();
    if (!tel) {
      const ident = String(contato.identifier || '').replace(/@.*$/, '').replace(/\D/g, '');
      if (ident.length >= 10) tel = '+' + ident;
    }
    const digitos = tel.replace(/\D/g, '');
    const cpf = String((contato.custom_attributes && contato.custom_attributes.cpf) || '')
      .replace(/\D/g, '');
    const caixa = caixas[c.inbox_id] || '';

    saida.push({ json: {
      convId: 'cw_' + num,
      convNum: num,
      trazerMensagens: trazer,
      conv: {
        id: 'cw_' + num,
        nome: contato.name || 'Contato',
        telefone: tel,
        caixa,
        ultima: texto.slice(0, 120),
        deUltima: deU,
        ts: ts || Date.now(),
        // Quando a conversa NASCEU — sem isto o filtro de periodo do
        // WhatsLive so enxerga a ultima atividade, e uma conversa de
        // janeiro que recebeu disparo em agosto some da busca de janeiro.
        criadaEm: criada || ts || Date.now(),
      },
      contato: {
        nome: contato.name || 'Contato',
        telefone: tel,
        digitos,
        cpf: cpf.length === 11 ? cpf : '',
        criadoEm: criada || ts || Date.now(),
        caixa,
      },
    } });
  }
}
return saida;
