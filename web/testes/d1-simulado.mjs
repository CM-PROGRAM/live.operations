/* D1 falso para testar o importador sem tocar a Cloudflare: responde no
   formato da API /d1/database/<id>/query com dados parecidos com os reais.
   Carregado com: tsx --import ./testes/d1-simulado.mjs scripts/importar-d1.ts */
const b64url = (buf) => Buffer.from(buf).toString("base64url")
async function hashDoWorker(senha, sal, voltas) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), { name: "PBKDF2" }, false, ["deriveBits"])
  return b64url(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: Buffer.from(sal, "base64url"), iterations: voltas, hash: "SHA-256" }, base, 256))
}
const sal = b64url(crypto.getRandomValues(new Uint8Array(16)))
const SENHAS = [
  { chave: "gustavo", sal, hash: await hashDoWorker("senhaDoCofre1", sal, 60000), iter: 60000 },
  { chave: "fulano", sal, hash: "x", iter: 150000 },
]
const TAREFAS = [
  { id: "atv_mkt_20260903_magalu_4vita_sac", titulo: "Magalu", status: "concluida", prioridade: "urgente", responsaveis: ["matheusm"],
    concluidoPorKey: "matheusm", concluidoEm: "03/09/2026, 11:23", rotinaMkt: "2026-09-03", vencimento: "2026-09-03",
    comentarios: [{ texto: "Sem MLB.", autor: "Matheus M" }], provaConclusao: "data:image/jpeg;base64,AAAA" },
  { id: "atv_integ_integ_1788139928082_x", titulo: "Integração · LE23136", status: "andamento", pendencia: "Falta foto",
    prioridade: "normal", responsavel: "gustavo", origemIntegId: "integ_1788139928082" },
  { id: "atv_dia_1788717017432_36f0", titulo: "Teste", status: "aberta", prioridade: "alta", responsaveis: ["ninguem"] },
]
const original = globalThis.fetch
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith("https://api.cloudflare.com/")) return original(url, init)
  const { sql, params } = JSON.parse(init.body)
  let results
  if (sql.includes("FROM senhas")) results = SENHAS
  else if (sql.includes("reg/atividades")) results = params[0] === 0 ? TAREFAS.map((t) => ({ dados: JSON.stringify(t) })) : []
  else throw new Error("consulta inesperada ao D1: " + sql)
  return new Response(JSON.stringify({ success: true, result: [{ results }] }))
}
