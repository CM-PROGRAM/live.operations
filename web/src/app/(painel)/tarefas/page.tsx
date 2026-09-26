import type { Metadata } from "next"
import { exigirUsuario, podeVer } from "@/backend/auth/sessao"
import { contarPorStatus, listarPessoas, listarTarefas } from "@/backend/tarefas/servico"
import { FiltroTarefas } from "@/comum/tarefas"
import { CentralTarefas } from "@/frontend/tarefas/central-tarefas"

export const metadata: Metadata = { title: "Tarefas" }

/* O filtro mora na URL: dá para mandar o link de "atrasadas do Gustavo"
   para alguém, e o F5 não perde onde você estava. */
export default async function PaginaTarefas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const u = await exigirUsuario()
  if (!podeVer(u, "tarefas")) {
    return <p className="text-muted-foreground">Você não tem acesso à Central de Tarefas. Peça ao master.</p>
  }
  const sp = await searchParams
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined
  const lido = FiltroTarefas.safeParse({ status: um(sp.status), responsavel: um(sp.responsavel), busca: um(sp.busca) })
  const filtro = lido.success ? lido.data : FiltroTarefas.parse({})

  const [tarefas, contagem, pessoas] = await Promise.all([
    listarTarefas(filtro),
    contarPorStatus(filtro.responsavel),
    listarPessoas(),
  ])
  return <CentralTarefas tarefas={tarefas} contagem={contagem} pessoas={pessoas} filtro={filtro} eu={u.chave} />
}
