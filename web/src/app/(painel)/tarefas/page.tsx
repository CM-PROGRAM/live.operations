import type { Metadata } from "next"
import { exigirUsuario, podeVer } from "@/backend/auth/sessao"
import { DIAS_CONCLUIDAS_NO_QUADRO, abertasPorArea, listarPessoas, listarTarefas } from "@/backend/tarefas/servico"
import { AREAS, FiltroTarefas, INFO_AREA } from "@/comum/tarefas"
import { CentralTarefas } from "@/frontend/tarefas/central-tarefas"

export const metadata: Metadata = { title: "Tarefas" }

/* O filtro mora na URL: dá para mandar o link de "Marketplaces da Ana"
   para alguém, e o F5 não perde onde você estava. */
export default async function PaginaTarefas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const u = await exigirUsuario()
  if (!podeVer(u, "tarefas")) {
    return <p className="text-muted-foreground">Você não tem acesso à Central de Tarefas. Peça ao master.</p>
  }
  // Mesma regra do sistema atual: área sem permissão exigida é de todos;
  // as outras seguem a permissão da aba correspondente
  const areas = AREAS.filter((a) => INFO_AREA[a].permissao === null || podeVer(u, INFO_AREA[a].permissao!))

  const sp = await searchParams
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined
  const lido = FiltroTarefas.safeParse({ responsavel: um(sp.responsavel), busca: um(sp.busca), area: um(sp.area) })
  const filtro = lido.success && (!lido.data.area || areas.includes(lido.data.area)) ? lido.data : FiltroTarefas.parse({})

  const [tarefas, abertas, pessoas] = await Promise.all([
    listarTarefas(filtro, { quadro: true, limite: 600 }),
    abertasPorArea(),
    listarPessoas(),
  ])
  return (
    <CentralTarefas
      tarefas={filtro.area ? tarefas : tarefas.filter((t) => areas.includes(t.area))}
      pessoas={pessoas}
      filtro={filtro}
      eu={u.chave}
      areas={areas}
      abertasPorArea={Object.fromEntries(areas.map((a) => [a, abertas[a] ?? 0]))}
      diasConcluidas={DIAS_CONCLUIDAS_NO_QUADRO}
    />
  )
}
