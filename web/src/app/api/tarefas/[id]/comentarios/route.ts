import { idDaRota, rota } from "@/backend/http"
import { comentarTarefa } from "@/backend/tarefas/servico"
import { NovoComentario } from "@/comum/tarefas"

type Ctx = RouteContext<"/api/tarefas/[id]/comentarios">

export const POST = rota<Ctx>("tarefas", async (u, req, ctx) => {
  const { texto } = NovoComentario.parse(await req.json())
  await comentarTarefa(idDaRota((await ctx.params).id), texto, u)
  return Response.json({ ok: true }, { status: 201 })
})
