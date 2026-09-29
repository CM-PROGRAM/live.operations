import { ErroDeSenha, redefinirComToken } from "@/backend/auth/senhas"
import { Redefinicao } from "@/comum/senha"

export async function POST(req: Request) {
  const d = Redefinicao.safeParse(await req.json().catch(() => null))
  if (!d.success) return Response.json({ erro: d.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 })
  try {
    await redefinirComToken(d.data.token, d.data.nova)
    return Response.json({ ok: true })
  } catch (e) {
    if (e instanceof ErroDeSenha) return Response.json({ erro: e.message }, { status: 400 })
    console.error("[senha] redefinir", e)
    return Response.json({ erro: "Falha no servidor. Tente de novo." }, { status: 500 })
  }
}
