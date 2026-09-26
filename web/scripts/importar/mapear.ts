/* Converte uma tarefa do sistema atual (reg/atividades no D1) para as
   colunas da tabela `tarefas`. Função pura — sem banco, sem rede — para
   poder ser testada contra os formatos reais que existem lá. */

export type TarefaLegada = Record<string, unknown> & { id: string }

export type TarefaMapeada = {
  legado_id: string
  titulo: string
  descricao: string | null
  prioridade: "normal" | "alta" | "urgente"
  status: "aberta" | "andamento" | "concluida" | "finalizada"
  pendencia: string | null
  vencimento: string | null
  prazo_horas: number | null
  responsaveis: string[] // chaves
  criado_por: string | null
  criado_em: Date | null
  concluido_por: string | null
  concluido_em: Date | null
  origem: string
  origem_ref: string | null
  comentarios: { texto: string; autorNome: string | null; em: Date | null }[]
  legado: Record<string, unknown>
}

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

/* O sistema atual grava datas como "31/08/2026, 09:48" no horário de
   Brasília. Sem o fuso, 09:48 viraria 09:48 UTC — três horas de erro. */
export function dataBR(v: unknown): Date | null {
  const s = texto(v)
  if (!s) return null
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:,?\s*(\d{2}):(\d{2}))?/)
  if (!m) return null
  const [, d, mes, a, h = "12", min = "00"] = m
  const dt = new Date(`${a}-${mes}-${d}T${h}:${min}:00-03:00`)
  return isNaN(dt.getTime()) ? null : dt
}

const dataMs = (v: unknown) => (typeof v === "number" && v > 1e12 ? new Date(v) : null)

function dataISO(v: unknown): string | null {
  const s = texto(v)
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

// Em ordem: a primeira marca de origem encontrada decide
const ORIGENS: [campo: string, origem: string][] = [
  ["rotinaMkt", "rotina"],
  ["origemIntegId", "integracao"],
  ["origemCancId", "cancelada"],
  ["origemCancNfId", "canceladaNF"],
  ["origemExIntId", "exclusaoInt"],
  ["origemAteId", "atendimento"],
  ["origemImgId", "imagem"],
  ["origemAtuCatId", "atuCatalogo"],
  ["origemDevolucaoId", "devolucao"],
  ["vendaPedidoId", "venda"],
]

// Campos que viraram coluna — o resto vai inteiro para `legado`
const PROMOVIDOS = new Set([
  "id", "titulo", "descricao", "prioridade", "status", "pendencia", "vencimento", "prazoHoras",
  "responsavel", "responsaveis", "criadoPor", "criadoPorKey", "criadoEm", "concluidoPor",
  "concluidoPorKey", "concluidoEm", "concluidoTs", "finalizadoPor", "finalizadoEm", "finalizadoTs",
  "comentarios", "comentario", "comentarioAutor", "comentarioEm", "_by", "ordemManual",
])

export function mapearTarefa(t: TarefaLegada, chavesValidas: Set<string>): TarefaMapeada {
  const prioridade = (["normal", "alta", "urgente"] as const).find((p) => p === t.prioridade) ?? "normal"
  const status = (["aberta", "andamento", "concluida", "finalizada"] as const).find((s) => s === t.status) ?? "aberta"

  const lista = Array.isArray(t.responsaveis) ? t.responsaveis : [t.responsavel]
  const responsaveis = [...new Set(lista.filter((k): k is string => typeof k === "string" && chavesValidas.has(k)))]

  const [campoOrigem, origem] = ORIGENS.find(([c]) => texto(t[c])) ?? [null, "manual"]

  const concluida = status === "concluida" || status === "finalizada"
  const chaveConclusao = texto(t.concluidoPorKey)
  const concluido_em = concluida
    ? dataMs(t.concluidoTs) ?? dataBR(t.concluidoEm) ?? dataMs(t.finalizadoTs) ?? dataBR(t.finalizadoEm)
    : null

  const comentarios: TarefaMapeada["comentarios"] = []
  if (Array.isArray(t.comentarios)) {
    for (const c of t.comentarios as Record<string, unknown>[]) {
      const tx = texto(c?.texto)
      if (tx) comentarios.push({ texto: tx, autorNome: texto(c.autor), em: dataBR(c.em) ?? dataMs(c.ts) })
    }
  }
  // O formato antigo, de um comentário só, convive com a lista em 15 tarefas
  const unico = texto(t.comentario)
  if (unico && !comentarios.some((c) => c.texto === unico)) {
    comentarios.push({ texto: unico, autorNome: texto(t.comentarioAutor), em: dataBR(t.comentarioEm) })
  }

  const legado: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(t)) {
    if (PROMOVIDOS.has(k)) continue
    // Imagem inteira em base64 não viaja: a original está no R2, e a
    // referência (…Ref) vem junto com o resto.
    if (typeof v === "string" && v.startsWith("data:")) continue
    legado[k] = v
  }

  const criadoPor = texto(t.criadoPorKey)
  return {
    legado_id: t.id,
    titulo: texto(t.titulo) ?? "(sem título)",
    descricao: texto(t.descricao),
    prioridade,
    status,
    pendencia: texto(t.pendencia),
    vencimento: dataISO(t.vencimento),
    prazo_horas: typeof t.prazoHoras === "number" ? t.prazoHoras : null,
    responsaveis,
    criado_por: criadoPor && chavesValidas.has(criadoPor) ? criadoPor : null,
    criado_em: dataBR(t.criadoEm) ?? idComData(t.id),
    concluido_por: chaveConclusao && chavesValidas.has(chaveConclusao) ? chaveConclusao : null,
    concluido_em,
    origem,
    origem_ref: campoOrigem ? texto(t[campoOrigem]) : null,
    comentarios,
    legado,
  }
}

/* Boa parte dos ids tem a hora de criação embutida (atv_dia_1788717017432_…,
   atv_integ_integ_1788139928082_…). Serve de data de criação quando o
   campo criadoEm não existe. */
function idComData(id: string): Date | null {
  const m = id.match(/(1[6-9]\d{11})/)
  return m ? new Date(Number(m[1])) : null
}
