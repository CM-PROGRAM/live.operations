import { rota } from "@/backend/http"
import { contarPorStatus, criarTarefa, listarTarefas } from "@/backend/tarefas/servico"
import { FiltroTarefas, NovaTarefa } from "@/comum/tarefas"

export const GET = rota("tarefas", async (_u, req) => {
  const p = new URL(req.url).searchParams
  const filtro = FiltroTarefas.parse({
    status: p.get("status") ?? undefined,
    responsavel: p.get("responsavel") || undefined,
    busca: p.get("busca") || undefined,
  })
  const [tarefas, contagem] = await Promise.all([listarTarefas(filtro), contarPorStatus(filtro.responsavel)])
  return Response.json({ tarefas, contagem })
})

export const POST = rota("tarefas", async (u, req) => {
  const id = await criarTarefa(NovaTarefa.parse(await req.json()), u)
  return Response.json({ id }, { status: 201 })
})
