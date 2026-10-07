/* Cria (ou atualiza) os usuários e as permissões de base, e define a senha
   de alguém. É a porta de entrada de um banco novo: sem ela, ninguém
   consegue entrar para usar o resto.

   Uso:
     DATABASE_URL=... npm run db:usuarios                 → só os usuários
     DATABASE_URL=... npm run db:usuarios -- cmandrade    → e pede a senha dele

   A senha é lida do terminal (ou da variável SENHA, para testes) e nunca
   fica em arquivo. Permissões aqui são só SOMADAS: o script não revoga o
   que o master concedeu pela tela. */
import { createInterface } from "node:readline/promises"
import { Client } from "pg"

/* O dono do sistema. Quem entrar depois é cadastrado pelo master. */
const BASE = [
  { chave: "cmandrade", nome: "CM Andrade", email: "cmandrade@suplelive.com.br", master: true, cor: "#e8c25a", iniciais: "CM", perms: ["whatsapp", "plataformas", "baixas", "envios", "anuncios", "devolucoes", "atendimentos", "tarefas", "admin"] },
]

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  for (const u of BASE) {
    const r = await c.query<{ id: string }>(
      `INSERT INTO usuarios (chave, nome, email, master, cor, iniciais) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (chave) DO UPDATE SET nome = EXCLUDED.nome, email = EXCLUDED.email, cor = EXCLUDED.cor,
         iniciais = EXCLUDED.iniciais, atualizado_em = now()
       RETURNING id`,
      [u.chave, u.nome, u.email, u.master, u.cor, u.iniciais]
    )
    for (const p of u.perms) {
      await c.query(
        "INSERT INTO permissoes (usuario_id, permissao, concedida) VALUES ($1, $2, true) ON CONFLICT DO NOTHING",
        [r.rows[0].id, p]
      )
    }
  }
  console.log(`${BASE.length} usuário(s) conferidos`)

  const chave = process.argv[2]
  if (chave) {
    let senha = process.env.SENHA
    if (!senha) {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      senha = await rl.question(`Nova senha para ${chave}: `)
      rl.close()
    }
    if (!senha || senha.length < 8) throw new Error("senha curta demais (mínimo 8)")
    // bcrypt feito pelo Postgres, como em src/backend/auth/senha.ts
    const r = await c.query(
      `INSERT INTO senhas (usuario_id, hash)
       SELECT id, crypt($2, gen_salt('bf', 10)) FROM usuarios WHERE chave = $1
       ON CONFLICT (usuario_id) DO UPDATE SET hash = EXCLUDED.hash, atualizado_em = now()`,
      [chave, senha]
    )
    if (!r.rowCount) throw new Error(`usuário ${chave} não existe`)
    console.log(`senha de ${chave} definida`)
  }
  await c.end()
}
main().catch((e) => { console.error(e.message); process.exit(1) })
