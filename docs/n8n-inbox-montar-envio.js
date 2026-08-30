// Vem do Inbox do LiveOps: {conv:'cw_123', texto, autor:'CM'|'Gustavo'|..., cru?}
const b = $json.body || $json;
const texto = String(b.texto || '').trim().slice(0, 4000);
const conv = String(b.conv || '');
const num = conv.replace(/^cw_/, '');
if (!texto || !/^\d+$/.test(num)) return [];
const quem = String(b.autor || '').trim() || '?';
const ts = Date.now();

// cru = comando do canal (/iniciar_atendimento, /pix). O canal so reconhece
// o comando quando ele e a mensagem INTEIRA — por isso este nao leva a
// assinatura da persona. Dentro do LiveOps ele fica como nota interna: a
// equipe ve quem disparou, e o balao nao se confunde com fala ao cliente.
const cru = b.cru === true || b.cru === 'true';

// O CLIENTE ve sempre a persona da empresa; o registro interno guarda quem
// realmente mandou (Manoel (CM), Manoel (Gustavo)...), gravado direto no
// Cloudflare pelos mesmos nos Gravar — o eco do Chatwoot e descartado no
// Mapear mensagem para nao duplicar o balao.
const conteudo = cru ? texto : ('*Manoel - Suplelive:*\n' + texto);
const registro = cru
  ? { texto: '⚡ ' + texto + ' — disparado no canal', de: 'nota', autor: quem, ts }
  : { texto, de: 'agente', autor: 'Manoel (' + quem + ')', ts };

return [{ json: {
  convNum: num,
  corpo: { content: conteudo, message_type: 'outgoing', private: false },
  convId: conv,
  msgId: (cru ? 'lc' : 'ls') + ts,
  conv: { id: conv, ultima: texto.slice(0, 120), deUltima: 'agente', ts },
  msg: registro
} }];
