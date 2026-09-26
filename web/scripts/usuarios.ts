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
import { criarHash } from "../src/backend/auth/senha"

// A mesma base do patchUsers do sistema atual (index.html)
const BASE = [
  { chave: "cmandrade", nome: "CM Andrade", email: "cmandrade@suplelive.com.br", master: true,  cor: "#e8c25a", iniciais: "CM", perms: ["whatsapp", "plataformas", "baixas", "envios", "anuncios", "devolucoes", "atendimentos", "tarefas", "admin"] },
  // Gustavo é #ffffff no sistema atual: branco some no tema claro do layout novo
  { chave: "gustavo",   nome: "Gustavo",    email: "gustavo@suplelive.com.br",   master: false, cor: "#64748b", iniciais: "G",  perms: ["plataformas", "envios", "tarefas", "base", "integracoes"] },
  { chave: "matheusm",  nome: "Matheus M",  email: "contato@suplelive.com.br",   master: false, cor: "#3b82f6", iniciais: "MM", perms: ["whatsapp", "tarefas", "cnpjs", "integracoes"] },
  { chave: "carlosred", nome: "Carlos Red", email: "carlos@suplelive.com.br",    master: false, cor: "#ef4444", iniciais: "CR", perms: ["whatsapp", "devolucoes", "tarefas", "cnpjs"] },
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
    if (!senha || senha.length < 6) throw new Error("senha curta demais (mínimo 6)")
    const { sal, hash, voltas } = await criarHash(senha)
    const r = await c.query(
      `INSERT INTO senhas (usuario_id, sal, hash, iteracoes)
       SELECT id, $2, $3, $4 FROM usuarios WHERE chave = $1
       ON CONFLICT (usuario_id) DO UPDATE SET sal = EXCLUDED.sal, hash = EXCLUDED.hash,
         iteracoes = EXCLUDED.iteracoes, atualizado_em = now()`,
      [chave, sal, hash, voltas]
    )
    if (!r.rowCount) throw new Error(`usuário ${chave} não existe`)
    console.log(`senha de ${chave} definida`)
  }
  await c.end()
}
main().catch((e) => { console.error(e.message); process.exit(1) })
