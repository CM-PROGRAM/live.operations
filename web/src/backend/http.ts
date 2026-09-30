import "server-only"
import * as z from "zod"
import { podeVer, usuarioAtual, type Usuario } from "@/backend/auth/sessao"
import { ErroDeNegocio } from "@/backend/tarefas/servico"

/* Toda rota da API passa por aqui: quem é, se pode, e o que responder
   quando algo dá errado. Permissão se confere no servidor — esconder o
   botão na tela nunca foi controle de acesso. */
export function rota<C>(permissao: string, fn: (u: Usuario, req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      const u = await usuarioAtual()
      if (!u) return Response.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 })
      if (!podeVer(u, permissao)) return Response.json({ erro: "Sem permissão" }, { status: 403 })
      return await fn(u, req, ctx)
    } catch (e) {
      if (e instanceof z.ZodError) {
        return Response.json({ erro: e.issues[0]?.message ?? "Dados inválidos", campos: z.flattenError(e).fieldErrors }, { status: 400 })
      }
      if (e instanceof ErroDeNegocio) return Response.json({ erro: e.message }, { status: 409 })
      // Falha que ninguém vê é dia de trabalho perdido: loga sempre.
      console.error("[api]", req.method, new URL(req.url).pathname, e)
      return Response.json({ erro: "Falha no servidor. Tente de novo." }, { status: 500 })
    }
  }
}

export function idDaRota(bruto: string): number {
  const id = Number(bruto)
  if (!Number.isSafeInteger(id) || id <= 0) throw new ErroDeNegocio("Tarefa não encontrada")
  return id
}
