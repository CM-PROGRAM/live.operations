import "server-only"
import { createHash, randomBytes } from "node:crypto"
import { cache } from "react"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { consultar } from "@/backend/db"

export const COOKIE_SESSAO = "liveops_sessao"
// 12 horas: um dia de trabalho, não mais.
const SESSAO_HORAS = 12

const hashDoToken = (t: string) => createHash("sha256").update(t).digest("hex")

export type Usuario = {
  id: number
  chave: string
  nome: string
  email: string
  master: boolean
  cor: string
  iniciais: string
  permissoes: string[]
}

export async function criarSessao(usuarioId: number) {
  const token = randomBytes(32).toString("base64url")
  const expira = new Date(Date.now() + SESSAO_HORAS * 3600_000)
  const h = await headers()
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || null
  await consultar(
    `INSERT INTO sessoes (token_hash, usuario_id, expira_em, ip, agente)
     VALUES ($1, $2, $3, $4::inet, $5)`,
    [hashDoToken(token), usuarioId, expira, ip, h.get("user-agent")]
  )
  ;(await cookies()).set(COOKIE_SESSAO, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expira,
  })
}

export async function encerrarSessao() {
  const jar = await cookies()
  const token = jar.get(COOKIE_SESSAO)?.value
  if (token) {
    await consultar(
      "UPDATE sessoes SET revogada_em = now() WHERE token_hash = $1 AND revogada_em IS NULL",
      [hashDoToken(token)]
    )
  }
  jar.delete(COOKIE_SESSAO)
}

/* A conferência de verdade: cookie → sessão viva → usuário ativo.
   O proxy só olha se o cookie existe; quem decide é aqui, perto do dado.
   `cache` faz a consulta valer uma vez por requisição. */
export const usuarioAtual = cache(async (): Promise<Usuario | null> => {
  const token = (await cookies()).get(COOKIE_SESSAO)?.value
  if (!token) return null
  const linhas = await consultar<Usuario>(
    `SELECT u.id::int AS id, u.chave, u.nome, u.email::text AS email, u.master, u.cor, u.iniciais,
            COALESCE(array_agg(p.permissao) FILTER (WHERE p.concedida), '{}') AS permissoes
       FROM sessoes s
       JOIN usuarios u ON u.id = s.usuario_id AND u.ativo
       LEFT JOIN permissoes p ON p.usuario_id = u.id
      WHERE s.token_hash = $1 AND s.revogada_em IS NULL AND s.expira_em > now()
      GROUP BY u.id`,
    [hashDoToken(token)]
  )
  return linhas[0] ?? null
})

export async function exigirUsuario(): Promise<Usuario> {
  const u = await usuarioAtual()
  if (!u) redirect("/entrar")
  return u
}

export function podeVer(u: Usuario, permissao: string) {
  return u.master || u.permissoes.includes(permissao)
}
