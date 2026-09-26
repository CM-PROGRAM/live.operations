/* Aplica, em ordem, os arquivos de db/migracoes que ainda não rodaram.
   Cada um roda numa transação: ou entra inteiro, ou não entra.
   Uso: DATABASE_URL=... npm run db:migrar */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Client } from "pg"

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL não configurada")
  const c = new Client({ connectionString: url })
  await c.connect()
  await c.query("CREATE TABLE IF NOT EXISTS _migracoes (nome text PRIMARY KEY, em timestamptz NOT NULL DEFAULT now())")
  const feitas = new Set((await c.query<{ nome: string }>("SELECT nome FROM _migracoes")).rows.map((r) => r.nome))
  const pasta = join(__dirname, "..", "db", "migracoes")
  for (const nome of readdirSync(pasta).filter((f) => f.endsWith(".sql")).sort()) {
    if (feitas.has(nome)) continue
    process.stdout.write(`aplicando ${nome}… `)
    try {
      await c.query("BEGIN")
      await c.query(readFileSync(join(pasta, nome), "utf8"))
      await c.query("INSERT INTO _migracoes (nome) VALUES ($1)", [nome])
      await c.query("COMMIT")
      console.log("ok")
    } catch (e) {
      await c.query("ROLLBACK")
      console.log("FALHOU")
      throw e
    }
  }
  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
