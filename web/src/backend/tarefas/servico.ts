import "server-only"
import type { PoolClient } from "pg"
import { consultar, emTransacao } from "@/backend/db"
import type { Usuario } from "@/backend/auth/sessao"
import type {
  Area,
  EdicaoTarefa,
  FiltroStatus,
  FiltroTarefas,
  NovaTarefa,
  TarefaDetalhe,
  TarefaResumo,
} from "@/comum/tarefas"

/* O "hoje" da equipe é o de Brasília, não o do servidor (UTC). Às 22h
   daqui já é amanhã em UTC — e uma tarefa que vence hoje apareceria
   atrasada a noite inteira. */
const HOJE = "(now() AT TIME ZONE 'America/Sao_Paulo')::date"
const ATRASADA = `(t.status IN ('aberta','andamento') AND t.vencimento < ${HOJE})`
const iso = (col: string) => `to_json(${col}) #>> '{}'`

const SELECT_RESUMO = `
  SELECT t.id::int AS id, t.titulo, t.descricao, t.prioridade, t.status, t.pendencia,
         t.vencimento::text AS vencimento, ${ATRASADA} AS atrasada,
         COALESCE((SELECT json_agg(json_build_object('chave', u.chave, 'nome', u.nome, 'cor', u.cor, 'iniciais', u.iniciais) ORDER BY u.nome)
                     FROM tarefa_responsaveis tr JOIN usuarios u ON u.id = tr.usuario_id
                    WHERE tr.tarefa_id = t.id), '[]') AS responsaveis,
         (SELECT count(*)::int FROM comentarios c
           WHERE c.entidade = 'tarefa' AND c.entidade_id = t.id AND c.excluido_em IS NULL) AS comentarios,
         ${iso("t.criado_em")} AS criado_em, ${iso("t.concluido_em")} AS concluido_em,
         (SELECT nome FROM usuarios WHERE id = t.concluido_por) AS concluido_por,
         t.origem, t.area
    FROM tarefas t`

function condicaoStatus(s: FiltroStatus): string {
  if (s === "todas") return "TRUE"
  if (s === "atrasada") return ATRASADA
  return `t.status = '${s}'` // s vem de um enum validado, nunca do usuário cru
}

/* No quadro, o que já acabou aparece só se acabou há pouco: a coluna de
   concluídas é para conferir o trabalho recente, não um arquivo de anos
   (a Central antiga escondia pelo mesmo motivo). */
export const DIAS_CONCLUIDAS_NO_QUADRO = 14

export async function listarTarefas(
  f: FiltroTarefas,
  opcoes: { limite?: number; quadro?: boolean } = {}
): Promise<TarefaResumo[]> {
  const limite = opcoes.limite ?? 300
  const valores: unknown[] = []
  const onde = ["t.excluido_em IS NULL", condicaoStatus(f.status)]
  if (opcoes.quadro) {
    onde.push(`(t.status IN ('aberta','andamento') OR t.concluido_em > now() - interval '${DIAS_CONCLUIDAS_NO_QUADRO} days')`)
  }
  if (f.area) {
    valores.push(f.area)
    onde.push(`t.area = $${valores.length}`)
  }
  if (f.responsavel) {
    valores.push(f.responsavel)
    onde.push(`EXISTS (SELECT 1 FROM tarefa_responsaveis tr JOIN usuarios u ON u.id = tr.usuario_id
                        WHERE tr.tarefa_id = t.id AND u.chave = $${valores.length})`)
  }
  if (f.busca) {
    valores.push("%" + f.busca + "%")
    onde.push(`(t.titulo ILIKE $${valores.length} OR t.descricao ILIKE $${valores.length})`)
  }
  valores.push(limite)
  /* Ordem de trabalho: o que está atrasado e é urgente primeiro; o que
     já acabou vai para o fim, do mais recente para o mais antigo. */
  return consultar<TarefaResumo>(
    `${SELECT_RESUMO}
      WHERE ${onde.join(" AND ")}
      ORDER BY (t.status IN ('concluida','finalizada')), ${ATRASADA} DESC,
               array_position(ARRAY['urgente','alta','normal'], t.prioridade),
               t.vencimento NULLS LAST, t.criado_em DESC
      LIMIT $${valores.length}`,
    valores
  )
}

export async function contarPorStatus(responsavel?: string, area?: Area): Promise<Record<FiltroStatus, number>> {
  const valores: unknown[] = []
  let filtro = ""
  if (responsavel) {
    valores.push(responsavel)
    filtro += ` AND EXISTS (SELECT 1 FROM tarefa_responsaveis tr JOIN usuarios u ON u.id = tr.usuario_id
                             WHERE tr.tarefa_id = t.id AND u.chave = $${valores.length})`
  }
  if (area) {
    valores.push(area)
    filtro += ` AND t.area = $${valores.length}`
  }
  const [r] = await consultar<Record<FiltroStatus, number>>(
    `SELECT count(*)::int AS todas,
            count(*) FILTER (WHERE t.status = 'aberta')::int AS aberta,
            count(*) FILTER (WHERE t.status = 'andamento')::int AS andamento,
            count(*) FILTER (WHERE ${ATRASADA})::int AS atrasada,
            count(*) FILTER (WHERE t.status = 'concluida')::int AS concluida,
            count(*) FILTER (WHERE t.status = 'finalizada')::int AS finalizada
       FROM tarefas t WHERE t.excluido_em IS NULL ${filtro}`,
    valores
  )
  return r
}

// O que está em aberto em cada área — o número que a equipe olha para
// decidir por onde começar o dia
export async function abertasPorArea(): Promise<Partial<Record<Area, number>>> {
  const linhas = await consultar<{ area: Area; n: number }>(
    `SELECT area, count(*)::int AS n FROM tarefas
      WHERE excluido_em IS NULL AND status IN ('aberta','andamento') GROUP BY area`
  )
  return Object.fromEntries(linhas.map((l) => [l.area, l.n]))
}

export async function obterTarefa(id: number): Promise<TarefaDetalhe | null> {
  const [t] = await consultar<TarefaResumo>(`${SELECT_RESUMO} WHERE t.id = $1 AND t.excluido_em IS NULL`, [id])
  if (!t) return null
  const [comentariosLista, historico] = await Promise.all([
    consultar<TarefaDetalhe["comentariosLista"][number]>(
      `SELECT c.id::int AS id, c.texto, u.nome AS autor, ${iso("c.criado_em")} AS criado_em
         FROM comentarios c LEFT JOIN usuarios u ON u.id = c.autor_id
        WHERE c.entidade = 'tarefa' AND c.entidade_id = $1 AND c.excluido_em IS NULL
        ORDER BY c.criado_em`,
      [id]
    ),
    consultar<TarefaDetalhe["historico"][number]>(
      `SELECT a.evento, a.campo, a.de, a.para, u.nome AS autor, ${iso("a.em")} AS em
         FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.entidade = 'tarefa' AND a.entidade_id = $1
        ORDER BY a.em DESC, a.id DESC LIMIT 100`,
      [id]
    ),
  ])
  return { ...t, comentariosLista, historico }
}

async function idsDosUsuarios(c: PoolClient, chaves: string[]): Promise<number[]> {
  const r = await c.query<{ id: number }>(
    "SELECT id::int AS id FROM usuarios WHERE chave = ANY($1) AND ativo",
    [chaves]
  )
  if (r.rows.length !== new Set(chaves).size) throw new ErroDeNegocio("Responsável desconhecido")
  return r.rows.map((x) => x.id)
}

async function auditar(
  c: PoolClient, tarefaId: number, evento: string, autor: Usuario,
  campo: string | null = null, de: unknown = null, para: unknown = null
) {
  const txt = (v: unknown) => (v === null || v === undefined ? null : Array.isArray(v) ? v.join(", ") : String(v))
  await c.query(
    `INSERT INTO auditoria (entidade, entidade_id, evento, campo, de, para, usuario_id)
     VALUES ('tarefa', $1, $2, $3, $4, $5, $6)`,
    [tarefaId, evento, campo, txt(de), txt(para), autor.id]
  )
}

export class ErroDeNegocio extends Error {}

export async function criarTarefa(dados: NovaTarefa, autor: Usuario): Promise<number> {
  return emTransacao(async (c) => {
    const ids = await idsDosUsuarios(c, dados.responsaveis)
    const r = await c.query<{ id: number }>(
      `INSERT INTO tarefas (titulo, descricao, prioridade, vencimento, responsavel_id, origem, criado_por, area)
       VALUES ($1, NULLIF($2, ''), $3, $4, $5, 'manual', $6, $7) RETURNING id::int AS id`,
      [dados.titulo, dados.descricao, dados.prioridade, dados.vencimento ?? null, ids[0], autor.id, dados.area]
    )
    const id = r.rows[0].id
    await c.query(
      "INSERT INTO tarefa_responsaveis (tarefa_id, usuario_id) SELECT $1, unnest($2::bigint[])",
      [id, ids]
    )
    await auditar(c, id, "criado", autor)
    return id
  })
}

const CAMPOS_SIMPLES = ["titulo", "descricao", "prioridade", "vencimento", "status", "pendencia"] as const

export async function editarTarefa(id: number, e: EdicaoTarefa, autor: Usuario): Promise<void> {
  await emTransacao(async (c) => {
    // FOR UPDATE: duas pessoas editando a mesma tarefa esperam a vez em
    // vez de uma sobrescrever a outra às cegas.
    const r = await c.query(
      `SELECT titulo, descricao, prioridade, vencimento::text AS vencimento, status, pendencia
         FROM tarefas WHERE id = $1 AND excluido_em IS NULL FOR UPDATE`,
      [id]
    )
    const atual = r.rows[0]
    if (!atual) throw new ErroDeNegocio("Tarefa não encontrada")

    for (const campo of CAMPOS_SIMPLES) {
      const novo = e[campo]
      if (novo === undefined || (novo ?? null) === (atual[campo] ?? null)) continue
      await c.query(`UPDATE tarefas SET ${campo} = $1, atualizado_em = now() WHERE id = $2`, [novo, id])
      await auditar(c, id, "editado", autor, campo, atual[campo], novo)
    }

    if (e.status && e.status !== atual.status) {
      const concluiu = e.status === "concluida" || e.status === "finalizada"
      const eraConcluida = atual.status === "concluida" || atual.status === "finalizada"
      if (concluiu && !eraConcluida) {
        await c.query("UPDATE tarefas SET concluido_em = now(), concluido_por = $1 WHERE id = $2", [autor.id, id])
      } else if (!concluiu && eraConcluida) {
        // Reabrir é uma decisão explícita de alguém, e fica auditada acima.
        await c.query("UPDATE tarefas SET concluido_em = NULL, concluido_por = NULL WHERE id = $1", [id])
      }
      if (e.status !== "andamento" && e.pendencia === undefined && atual.pendencia) {
        await c.query("UPDATE tarefas SET pendencia = NULL WHERE id = $1", [id])
      }
    }

    if (e.responsaveis) {
      const ids = await idsDosUsuarios(c, e.responsaveis)
      const antes = await c.query<{ chave: string }>(
        `SELECT u.chave FROM tarefa_responsaveis tr JOIN usuarios u ON u.id = tr.usuario_id
          WHERE tr.tarefa_id = $1 ORDER BY u.chave`,
        [id]
      )
      const de = antes.rows.map((x) => x.chave)
      const para = [...e.responsaveis].sort()
      if (de.join() !== para.join()) {
        await c.query("DELETE FROM tarefa_responsaveis WHERE tarefa_id = $1", [id])
        await c.query("INSERT INTO tarefa_responsaveis (tarefa_id, usuario_id) SELECT $1, unnest($2::bigint[])", [id, ids])
        await c.query("UPDATE tarefas SET responsavel_id = $1, atualizado_em = now() WHERE id = $2", [ids[0], id])
        await auditar(c, id, "editado", autor, "responsaveis", de, para)
      }
    }
  })
}

export async function comentarTarefa(id: number, texto: string, autor: Usuario): Promise<void> {
  await emTransacao(async (c) => {
    const r = await c.query("SELECT 1 FROM tarefas WHERE id = $1 AND excluido_em IS NULL", [id])
    if (!r.rowCount) throw new ErroDeNegocio("Tarefa não encontrada")
    await c.query(
      "INSERT INTO comentarios (entidade, entidade_id, texto, autor_id) VALUES ('tarefa', $1, $2, $3)",
      [id, texto, autor.id]
    )
  })
}

/* Exclusão lógica: some da tela, fica no banco. "Sumiu" passa a ser uma
   pergunta com resposta — quem excluiu e quando estão na auditoria. */
export async function excluirTarefa(id: number, autor: Usuario): Promise<void> {
  await emTransacao(async (c) => {
    const r = await c.query("UPDATE tarefas SET excluido_em = now() WHERE id = $1 AND excluido_em IS NULL", [id])
    if (!r.rowCount) throw new ErroDeNegocio("Tarefa não encontrada")
    await auditar(c, id, "excluido", autor)
  })
}

export async function listarPessoas() {
  return consultar<{ chave: string; nome: string; cor: string; iniciais: string }>(
    "SELECT chave, nome, cor, iniciais FROM usuarios WHERE ativo ORDER BY nome"
  )
}
