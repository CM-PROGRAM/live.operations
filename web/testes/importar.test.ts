/* O importador de ponta a ponta, contra um D1 simulado (d1-simulado.mjs)
   e um Postgres de verdade (TESTE_DATABASE_URL). O banco é recriado do
   zero: este teste precisa de um banco próprio, não o dos outros. */
import { before, test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { Client } from "pg"
import { conferirSenha } from "../src/backend/auth/senha"

const base = process.env.TESTE_DATABASE_URL
const opcoes = { skip: base ? false : "sem TESTE_DATABASE_URL" }
const url = base ? base.replace(/\/[^/]*$/, "/liveops_teste_importar") : ""

// Devolve stdout + stderr: os avisos do importador saem por console.warn
function rodar(...args: string[]) {
  const r = spawnSync("npx", ["tsx", ...args], {
    env: { ...process.env, DATABASE_URL: url, CF_ACCOUNT_ID: "x", CF_API_TOKEN: "x" }, encoding: "utf8",
  })
  if (r.status !== 0) throw new Error(`${args.at(-1)} falhou:\n${r.stderr}`)
  return r.stdout + r.stderr
}
async function consulta<T>(sql: string): Promise<T[]> {
  const c = new Client({ connectionString: url }); await c.connect()
  try { return (await c.query(sql)).rows } finally { await c.end() }
}

before(async () => {
  if (!base) return
  const adm = new Client({ connectionString: base }); await adm.connect()
  await adm.query("DROP DATABASE IF EXISTS liveops_teste_importar")
  await adm.query("CREATE DATABASE liveops_teste_importar")
  await adm.end()
  rodar("scripts/migrar.ts"); rodar("scripts/usuarios.ts")
})

test("importa, e a segunda rodada atualiza sem duplicar", opcoes, () => {
  const r1 = rodar("--import", "./testes/d1-simulado.mjs", "scripts/importar-d1.ts")
  assert.match(r1, /3 nova\(s\), 0 atualizada\(s\), 1 comentário/)
  assert.match(r1, /senha de "fulano" ignorada/)
  const r2 = rodar("--import", "./testes/d1-simulado.mjs", "scripts/importar-d1.ts")
  assert.match(r2, /0 nova\(s\), 3 atualizada\(s\), 0 comentário/)
})

test("campos mapeados como no sistema atual", opcoes, async () => {
  const t = await consulta<Record<string, unknown>>(
    `SELECT legado_id, status, pendencia, origem, to_json(concluido_em)#>>'{}' AS concluido_em,
            legado ? 'provaConclusao' AS base64, legado->>'rotinaMkt' AS rotina,
            (SELECT count(*)::int FROM tarefa_responsaveis WHERE tarefa_id = t.id) AS resp
       FROM tarefas t ORDER BY id`)
  assert.equal(t.length, 3)
  assert.equal(t[0].origem, "rotina"); assert.equal(t[0].rotina, "2026-09-03"); assert.equal(t[0].base64, false)
  assert.equal(t[0].concluido_em, "2026-09-03T14:23:00+00:00")
  assert.equal(t[1].status, "andamento"); assert.equal(t[1].pendencia, "Falta foto"); assert.equal(t[1].origem, "integracao")
  assert.equal(t[2].resp, 0) // 'ninguem' não é usuário: fica sem dono, e o importador avisa
  const [c] = await consulta<{ n: number }>("SELECT count(*)::int AS n FROM comentarios")
  assert.equal(c.n, 1)
})

test("a senha que veio do cofre do worker entra no sistema novo", opcoes, async () => {
  const [s] = await consulta<{ sal: string; hash: string; iteracoes: number }>(
    "SELECT s.sal, s.hash, s.iteracoes FROM senhas s JOIN usuarios u ON u.id = s.usuario_id WHERE u.chave = 'gustavo'")
  assert.equal(s.iteracoes, 60000)
  assert.equal(await conferirSenha("senhaDoCofre1", s), true)
  assert.equal(await conferirSenha("senhaErrada", s), false)
})
