import "server-only"
import type { ClientBase } from "pg"
import { consultar } from "@/backend/db"

/* As senhas são bcrypt (custo 10) calculado pelo próprio Postgres, com a
   extensão pgcrypto. A conta é lenta de propósito — é ela que torna
   inviável adivinhar senhas a partir de um banco vazado — e feita no
   banco ela não pesa no servidor do site, que no plano grátis da
   Cloudflare tem 10 ms de processamento por pedido.

   O sal é sorteado a cada senha e fica dentro do próprio hash
   ($2a$10$<sal><hash>), então senhas iguais nunca têm hash igual. */
export const CUSTO_BCRYPT = 10

// Gravar (ou trocar) a senha de alguém. A senha vai ao banco por conexão
// cifrada e só o hash fica gravado.
export async function definirSenha(c: ClientBase, usuarioId: number, senha: string, por: number | null) {
  await c.query(
    `INSERT INTO senhas (usuario_id, hash, atualizado_por)
     VALUES ($1, crypt($2, gen_salt('bf', ${CUSTO_BCRYPT})), $3)
     ON CONFLICT (usuario_id) DO UPDATE SET hash = EXCLUDED.hash,
       atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`,
    [usuarioId, senha, por]
  )
}

export async function conferirSenha(usuarioId: number, senha: string): Promise<boolean> {
  const [r] = await consultar<{ confere: boolean }>(
    "SELECT hash = crypt($2, hash) AS confere FROM senhas WHERE usuario_id = $1",
    [usuarioId, senha]
  )
  return r?.confere === true
}

/* Hash de uma senha que ninguém tem. Quando a conta procurada não existe,
   o login confere contra ele mesmo assim: a resposta leva o mesmo tempo
   e o relógio não entrega quais e-mails têm conta. */
export const HASH_DE_NINGUEM = "$2a$10$vss7DnC/JdO6xjvr1IY.ZOQRz5xQNIychrMhUnDBbKSCAl4M2Lv2C"
