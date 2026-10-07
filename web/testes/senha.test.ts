/* Senhas contra um Postgres de verdade (TESTE_DATABASE_URL): o hash é
   feito pelo banco, então não há o que testar sem ele. */
import { after, before, test } from "node:test"
import assert from "node:assert/strict"

const url = process.env.TESTE_DATABASE_URL
const opcoes = { skip: url ? false : "sem TESTE_DATABASE_URL" }
process.env.DATABASE_URL = url

let s: typeof import("../src/backend/auth/senha")
let db: typeof import("../src/backend/db")
let id = 0

before(async () => {
  if (!url) return
  s = await import("../src/backend/auth/senha")
  db = await import("../src/backend/db")
  await db.consultar(
    `INSERT INTO usuarios (chave, nome, email, iniciais) VALUES ('senha-teste', 'Senha', 'senha@exemplo.com', 'SE')
     ON CONFLICT (chave) DO NOTHING`
  )
  ;[{ id }] = await db.consultar<{ id: number }>("SELECT id::int AS id FROM usuarios WHERE chave = 'senha-teste'")
})

const gravar = (senha: string) => db.emTransacao((c) => s.definirSenha(c, id, senha, null))

test("a senha certa entra; errada, maiúscula trocada ou vazia não", opcoes, async () => {
  await gravar("minhaSenha çã 1")
  assert.equal(await s.conferirSenha(id, "minhaSenha çã 1"), true)
  assert.equal(await s.conferirSenha(id, "minhasenha çã 1"), false)
  assert.equal(await s.conferirSenha(id, ""), false)
})

test("só o hash bcrypt fica no banco, com sal novo a cada vez", opcoes, async () => {
  await gravar("igual123")
  const [a] = await db.consultar<{ hash: string }>("SELECT hash FROM senhas WHERE usuario_id = $1", [id])
  await gravar("igual123")
  const [b] = await db.consultar<{ hash: string }>("SELECT hash FROM senhas WHERE usuario_id = $1", [id])
  assert.match(a.hash, new RegExp(`^\\$2a\\$${s.CUSTO_BCRYPT}\\$`))
  assert.ok(!a.hash.includes("igual123"))
  assert.notEqual(a.hash, b.hash)
  assert.equal(await s.conferirSenha(id, "igual123"), true)
})

test("o hash de ninguém é bcrypt válido e não confere com nada óbvio", opcoes, async () => {
  const [r] = await db.consultar<{ ok: boolean }>("SELECT crypt('', $1) = $1 AS ok", [s.HASH_DE_NINGUEM])
  assert.equal(r.ok, false)
  assert.match(s.HASH_DE_NINGUEM, /^\$2a\$10\$.{53}$/)
})

test("usuário sem senha não confere", opcoes, async () => {
  assert.equal(await s.conferirSenha(-1, "qualquer"), false)
})

after(async () => {
  if (!url) return
  await db.consultar("DELETE FROM usuarios WHERE chave = 'senha-teste'")
  await db.encerrarConexoes()
})
