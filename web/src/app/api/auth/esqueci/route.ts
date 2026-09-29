import { passouDoTeto } from "@/backend/auth/login"
import { pedirRedefinicao } from "@/backend/auth/senhas"
import { PedidoDeRedefinicao } from "@/comum/senha"

/* O link do e-mail aponta para APP_URL quando ela existe. Sem ela, usa o
   endereço que o navegador chamou — mas só o da Vercel, que confere o
   Host; nunca um cabeçalho que qualquer um pode forjar para desviar o
   link para outro site. */
function urlBase(req: Request) {
  return (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, "")
}

export async function POST(req: Request) {
  const d = PedidoDeRedefinicao.safeParse(await req.json().catch(() => null))
  if (!d.success) return Response.json({ erro: d.error.issues[0]?.message ?? "Informe o seu e-mail" }, { status: 400 })
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null
  if (passouDoTeto("esqueci:" + (ip ?? "?"))) {
    return Response.json({ erro: "Muitas tentativas. Espere um minuto e tente de novo." }, { status: 429 })
  }
  try {
    await pedirRedefinicao(d.data.email, urlBase(req), ip)
  } catch (e) {
    console.error("[senha] esqueci", e)
  }
  // Mesma resposta sempre: não revela se o e-mail tem conta
  return Response.json({ ok: true })
}
