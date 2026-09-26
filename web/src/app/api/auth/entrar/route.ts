import * as z from "zod"
import { entrar } from "@/backend/auth/login"

const Corpo = z.object({ usuario: z.string().trim().min(1).max(200), senha: z.string().min(1).max(500) })

export async function POST(req: Request) {
  const corpo = Corpo.safeParse(await req.json().catch(() => null))
  if (!corpo.success) return Response.json({ erro: "Informe e-mail e senha." }, { status: 400 })
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?"
  try {
    const r = await entrar(corpo.data.usuario, corpo.data.senha, ip)
    return r.ok ? Response.json({ ok: true }) : Response.json({ erro: r.erro }, { status: 401 })
  } catch (e) {
    console.error("[auth] entrar", e)
    return Response.json({ erro: "Falha no servidor. Tente de novo." }, { status: 500 })
  }
}
