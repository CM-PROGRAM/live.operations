import { idDaRota, rota } from "@/backend/http"
import { editarTarefa, excluirTarefa, obterTarefa } from "@/backend/tarefas/servico"
import { EdicaoTarefa } from "@/comum/tarefas"

type Ctx = RouteContext<"/api/tarefas/[id]">

export const GET = rota<Ctx>("tarefas", async (_u, _req, ctx) => {
  const t = await obterTarefa(idDaRota((await ctx.params).id))
  return t ? Response.json(t) : Response.json({ erro: "Tarefa não encontrada" }, { status: 404 })
})

export const PATCH = rota<Ctx>("tarefas", async (u, req, ctx) => {
  await editarTarefa(idDaRota((await ctx.params).id), EdicaoTarefa.parse(await req.json()), u)
  return Response.json({ ok: true })
})

export const DELETE = rota<Ctx>("tarefas", async (u, _req, ctx) => {
  await excluirTarefa(idDaRota((await ctx.params).id), u)
  return Response.json({ ok: true })
})
