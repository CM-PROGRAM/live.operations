#!/usr/bin/env node
/* Confere o ANINHAMENTO do index.html.
   Existe porque em 01/09 um </div> a mais foi apagado junto com a Etapa 3:
   o JS continuou válido, os ids continuaram únicos, e a página inteira sumiu,
   porque tudo o que vinha depois virou filho de um bloco display:none. */
const fs=require('fs');
const arq=process.argv[2]||'/home/user/suplive.processos/index.html';
const h=fs.readFileSync(arq,'utf8');

/* Fora de <script> e <style>, senão string com "</div>" vira tag. */
const limpo=h.replace(/<script[\s\S]*?<\/script>/gi,m=>m.replace(/[<>]/g,' '))
             .replace(/<style[\s\S]*?<\/style>/gi,m=>m.replace(/[<>]/g,' '))
             .replace(/<!--[\s\S]*?-->/g,'');

const VAZIAS=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const pilha=[]; const erros=[];
const re=/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
let m;
while((m=re.exec(limpo))){
  const fecha=!!m[1], nome=m[2].toLowerCase(), attrs=m[3];
  if(VAZIAS.has(nome) || /\/\s*$/.test(attrs)) continue;
  const linha=limpo.slice(0,m.index).split('\n').length;
  const id=(attrs.match(/id="([^"]+)"/)||[])[1]||'';
  if(!fecha){ pilha.push({nome,id,linha}); }
  else{
    if(!pilha.length){ erros.push(`linha ${linha}: </${nome}> sem abertura`); continue; }
    if(pilha[pilha.length-1].nome!==nome){
      const t=pilha[pilha.length-1];
      erros.push(`linha ${linha}: </${nome}> fecha <${t.nome}${t.id?' id="'+t.id+'"':''}> aberto na linha ${t.linha}`);
    }
    pilha.pop();
  }
}
pilha.filter(t=>!['html','body','head'].includes(t.nome)).forEach(t=>
  erros.push(`linha ${t.linha}: <${t.nome}${t.id?' id="'+t.id+'"':''}> nunca foi fechado`));

/* Blocos que NÃO podem morar dentro de outro — foi assim que a tela sumiu. */
const NAO_ANINHAR=[
  ['acp-bloco','acp-etapas'], ['acp-filtros','acp-etapas'], ['acp-seg','acp-etapas'],
  ['acp-etapas-barra','acp-etapas'], ['acp-ver-overlay','acp-etapas'],
  ['tab-tarefas','tab-envios'], ['tab-admin','tab-envios'], ['tab-inicio','tab-envios']
];
function ancestrais(alvo){
  const i=limpo.indexOf('id="'+alvo+'"'); if(i<0) return null;
  const p=[]; const r2=/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g; let t;
  while((t=r2.exec(limpo)) && t.index<i){
    const nome=t[2].toLowerCase(), attrs=t[3];
    if(VAZIAS.has(nome)||/\/\s*$/.test(attrs)) continue;
    if(t[1]) p.pop(); else p.push((attrs.match(/id="([^"]+)"/)||[])[1]||'');
  }
  return p.filter(Boolean);
}
NAO_ANINHAR.forEach(([filho,proibido])=>{
  const a=ancestrais(filho);
  if(a && a.includes(proibido)) erros.push(`#${filho} está DENTRO de #${proibido} — a tela some quando #${proibido} fecha`);
});

if(erros.length){ console.log('ESTRUTURA QUEBRADA:'); erros.slice(0,20).forEach(e=>console.log(' ✗ '+e)); process.exit(1); }
console.log('estrutura ok — aninhamento equilibrado, nada engolido');
