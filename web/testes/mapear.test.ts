import { test } from "node:test"
import assert from "node:assert/strict"
import { dataBR, mapearTarefa } from "../scripts/importar/mapear"

const chaves = new Set(["cmandrade", "gustavo", "matheusm", "carlosred"])

test("data brasileira vira UTC com o fuso de Brasília", () => {
  assert.equal(dataBR("31/08/2026, 09:48")?.toISOString(), "2026-08-31T12:48:00.000Z")
  assert.equal(dataBR("24/07/2026")?.toISOString(), "2026-07-24T15:00:00.000Z")
  assert.equal(dataBR("—"), null)
  assert.equal(dataBR(undefined), null)
})

test("tarefa da rotina de marketplace, concluída, com imagem e comentários", () => {
  const t = mapearTarefa({
    id: "atv_mkt_20260903_magalu_4vitasuplementos_sac",
    titulo: "Magalu", descricao: "SAC — 4Vita", status: "concluida", prioridade: "urgente",
    vencimento: "2026-09-03", prazoHoras: 9, responsavel: "matheusm", responsaveis: ["matheusm", "fantasma"],
    criadoPor: "Sistema", criadoPorKey: "sistema", criadoEm: "03/09/2026, 08:00",
    concluidoPor: "Matheus M", concluidoPorKey: "matheusm", concluidoEm: "03/09/2026, 11:23",
    rotinaMkt: "2026-09-03", mktLoja: "4Vita", mktEtapa: "SAC",
    provaConclusao: "data:image/jpeg;base64,AAAA", provaConclusaoRef: "atv_x__prova",
    comentarios: [{ texto: "Sem MLB.", autor: "Matheus M" }, { texto: "  " }],
    comentario: "Sem MLB.", _by: "abc", ordemManual: 3,
  }, chaves)
  assert.equal(t.status, "concluida")
  assert.equal(t.prioridade, "urgente")
  assert.deepEqual(t.responsaveis, ["matheusm"])        // 'fantasma' não existe
  assert.equal(t.criado_por, null)                       // 'sistema' não é usuário
  assert.equal(t.concluido_por, "matheusm")
  assert.equal(t.concluido_em?.toISOString(), "2026-09-03T14:23:00.000Z")
  assert.equal(t.origem, "rotina")
  assert.equal(t.origem_ref, "2026-09-03")
  assert.equal(t.comentarios.length, 1)                  // vazio e duplicado ficam de fora
  assert.equal(t.legado.provaConclusao, undefined)       // base64 não viaja
  assert.equal(t.legado.provaConclusaoRef, "atv_x__prova")
  assert.equal(t.legado.mktLoja, "4Vita")
  assert.equal(t.legado._by, undefined)
})

test("tarefa aberta, sem campos opcionais, com data no id", () => {
  const t = mapearTarefa({ id: "atv_integ_integ_1788139928082_mtgkcetu", titulo: "", status: "xyz",
    prioridade: "altissima", vencimento: "", responsavel: "gustavo", origemIntegId: "integ_1788139928082" }, chaves)
  assert.equal(t.titulo, "(sem título)")
  assert.equal(t.status, "aberta")
  assert.equal(t.prioridade, "normal")
  assert.equal(t.vencimento, null)
  assert.deepEqual(t.responsaveis, ["gustavo"])
  assert.equal(t.origem, "integracao")
  assert.equal(t.concluido_em, null)
  assert.equal(t.criado_em?.getTime(), 1788139928082)
})

test("concluída só com concluidoTs em milissegundos", () => {
  const t = mapearTarefa({ id: "atv_1", titulo: "x", status: "finalizada", concluidoTs: 1788186199814, responsavel: "cmandrade" }, chaves)
  assert.equal(t.concluido_em?.getTime(), 1788186199814)
})

test("área segue a regra do sistema atual, na mesma ordem", async () => {
  const { areaDa } = await import("../scripts/importar/mapear")
  assert.equal(areaDa({ id: "a", areaTarefa: "financeiro", origemAteId: "ate_1" }), "financeiro") // marca explícita vence
  assert.equal(areaDa({ id: "a", areaTarefa: "inventada", origemAteId: "ate_1" }), "atendimentos")
  assert.equal(areaDa({ id: "a", rotinaMkt: "2026-09-03" }), "marketplaces")
  assert.equal(areaDa({ id: "a", vendaPedidoId: "ped_1" }), "financeiro")
  assert.equal(areaDa({ id: "a", origemCancNfId: "cancnf_1", origemCancId: "canc_1" }), "devolucoes") // NF vem antes
  assert.equal(areaDa({ id: "a", origemCancId: "canc_1" }), "vendas")
  assert.equal(areaDa({ id: "a", origemImgId: "img_1" }), "anuncios")
  assert.equal(areaDa({ id: "a", titulo: "  Integração " }), "anuncios")
  assert.equal(areaDa({ id: "a", titulo: "Ligar para fornecedor" }), "diarias")
})
