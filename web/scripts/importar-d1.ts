/* Traz do D1 (liveops-dados, o banco do sistema atual) para o Neon:
   as senhas do cofre e as tarefas (reg/atividades), com comentários.

   Pode rodar quantas vezes quiser: tarefa já importada é ATUALIZADA pelo
   legado_id, nunca duplicada. Não altera nada no D1 — só lê.

   Uso:
     DATABASE_URL=...            (Neon)
     CF_ACCOUNT_ID=...           (Cloudflare → qualquer página da conta, na barra lateral)
     CF_API_TOKEN=...            (token com permissão D1:Read)
     npm run db:importar

   Rode antes: npm run db:migrar && npm run db:usuarios */
import { Client } from "pg"
import { mapearTarefa, type TarefaLegada } from "./importar/mapear"

const D1_ID = "20b313cd-963c-4c4d-8584-f3c907124d12" // liveops-dados (wrangler.toml)

async function d1<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conta = process.env.CF_ACCOUNT_ID, token = process.env.CF_API_TOKEN
  if (!conta || !token) throw new Error("CF_ACCOUNT_ID e CF_API_TOKEN são obrigatórios")
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${conta}/d1/database/${D1_ID}/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  })
  const j = await r.json() as { success: boolean; errors?: unknown; result?: { results: T[] }[] }
  if (!j.success) throw new Error("D1 recusou: " + JSON.stringify(j.errors))
  return j.result![0].results
}

async function main() {
  const neon = new Client({ connectionString: process.env.DATABASE_URL })
  await neon.connect()

  const usuarios = new Map(
    (await neon.query<{ id: string; chave: string; nome: string }>("SELECT id, chave, nome FROM usuarios")).rows
      .map((u) => [u.chave, u])
  )
  if (!usuarios.size) throw new Error("nenhum usuário no Neon — rode npm run db:usuarios antes")
  const idPorNome = new Map([...usuarios.values()].map((u) => [u.nome.toLowerCase(), u.id]))
  const chaves = new Set(usuarios.keys())

  // ── Senhas: o cofre vem inteiro, e ninguém precisa redefinir a sua ──
  const senhas = await d1<{ chave: string; sal: string; hash: string; iter: number | null }>(
    "SELECT chave, sal, hash, iter FROM senhas"
  )
  let nSenhas = 0
  for (const s of senhas) {
    const u = usuarios.get(s.chave)
    if (!u) { console.warn(`senha de "${s.chave}" ignorada: usuário não existe no Neon`); continue }
    // iter nulo = linha antiga, feita com a volta máxima da escada do worker
    await neon.query(
      `INSERT INTO senhas (usuario_id, sal, hash, iteracoes) VALUES ($1, $2, $3, $4)
       ON CONFLICT (usuario_id) DO UPDATE SET sal = EXCLUDED.sal, hash = EXCLUDED.hash,
         iteracoes = EXCLUDED.iteracoes, atualizado_em = now()`,
      [u.id, s.sal, s.hash, s.iter || 150000]
    )
    nSenhas++
  }
  console.log(`senhas: ${nSenhas} de ${senhas.length}`)

  // ── Tarefas, em páginas ──
  let pagina = 0, novas = 0, atualizadas = 0, semResponsavel = 0, comentarios = 0
  for (;;) {
    const linhas = await d1<{ dados: string }>(
      "SELECT dados FROM registros WHERE colecao = 'reg/atividades' ORDER BY chave LIMIT 300 OFFSET ?1",
      [pagina * 300]
    )
    if (!linhas.length) break
    pagina++
    for (const { dados } of linhas) {
      const t = mapearTarefa(JSON.parse(dados) as TarefaLegada, chaves)
      if (!t.responsaveis.length) semResponsavel++
      const idDe = (k: string | null) => (k ? usuarios.get(k)?.id ?? null : null)
      await neon.query("BEGIN")
      try {
        const r = await neon.query<{ id: string; nova: boolean }>(
          `INSERT INTO tarefas (legado_id, titulo, descricao, prioridade, status, pendencia, vencimento, prazo_horas,
                                responsavel_id, criado_por, criado_em, concluido_por, concluido_em, origem, origem_ref, legado, area)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11, now()),$12,$13,$14,$15,$16,$17)
           ON CONFLICT (legado_id) DO UPDATE SET titulo = EXCLUDED.titulo, descricao = EXCLUDED.descricao,
             prioridade = EXCLUDED.prioridade, status = EXCLUDED.status, pendencia = EXCLUDED.pendencia,
             vencimento = EXCLUDED.vencimento, prazo_horas = EXCLUDED.prazo_horas,
             responsavel_id = EXCLUDED.responsavel_id, concluido_por = EXCLUDED.concluido_por,
             concluido_em = EXCLUDED.concluido_em, origem = EXCLUDED.origem, origem_ref = EXCLUDED.origem_ref,
             legado = EXCLUDED.legado, area = EXCLUDED.area, atualizado_em = now()
           RETURNING id, (xmax = 0) AS nova`,
          [t.legado_id, t.titulo, t.descricao, t.prioridade, t.status, t.pendencia, t.vencimento, t.prazo_horas,
           idDe(t.responsaveis[0] ?? null), idDe(t.criado_por), t.criado_em, idDe(t.concluido_por), t.concluido_em,
           t.origem, t.origem_ref, JSON.stringify(t.legado), t.area]
        )
        const { id, nova } = r.rows[0]
        await neon.query("DELETE FROM tarefa_responsaveis WHERE tarefa_id = $1", [id])
        for (const k of t.responsaveis) {
          await neon.query("INSERT INTO tarefa_responsaveis (tarefa_id, usuario_id) VALUES ($1, $2)", [id, idDe(k)])
        }
        // Comentários só na primeira vez: numa reimportação, os que já
        // vieram estão lá, e os feitos no sistema novo não podem sumir.
        if (nova) {
          novas++
          for (const c of t.comentarios) {
            await neon.query(
              `INSERT INTO comentarios (entidade, entidade_id, texto, autor_id, criado_em)
               VALUES ('tarefa', $1, $2, $3, COALESCE($4, now()))`,
              [id, c.texto, c.autorNome ? idPorNome.get(c.autorNome.toLowerCase()) ?? null : null, c.em]
            )
            comentarios++
          }
        } else atualizadas++
        await neon.query("COMMIT")
      } catch (e) {
        await neon.query("ROLLBACK")
        throw new Error(`tarefa ${t.legado_id}: ${(e as Error).message}`)
      }
    }
    process.stdout.write(`\rtarefas: ${novas + atualizadas}…`)
  }
  console.log(`\r\x1b[Ktarefas: ${novas} nova(s), ${atualizadas} atualizada(s), ${comentarios} comentário(s)`)
  if (semResponsavel) console.log(`atenção: ${semResponsavel} tarefa(s) sem responsável conhecido (ficaram sem dono)`)
  await neon.end()
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
