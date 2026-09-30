import { cookies } from "next/headers"
import { COOKIE_SESSAO, usuarioAtual } from "@/backend/auth/sessao"
import { ErroDeSenha, trocarSenha } from "@/backend/auth/senhas"
import { TrocaDeSenha } from "@/comum/senha"

export async function POST(req: Request) {
  const u = await usuarioAtual()
  if (!u) return Response.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 })
  const d = TrocaDeSenha.safeParse(await req.json().catch(() => null))
  if (!d.success) return Response.json({ erro: d.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 })
  try {
    await trocarSenha(u, d.data.atual, d.data.nova, (await cookies()).get(COOKIE_SESSAO)?.value)
    return Response.json({ ok: true })
  } catch (e) {
    if (e instanceof ErroDeSenha) return Response.json({ erro: e.message }, { status: 400 })
    console.error("[senha] trocar", e)
    return Response.json({ erro: "Falha no servidor. Tente de novo." }, { status: 500 })
  }
}
