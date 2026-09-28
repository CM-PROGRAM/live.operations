"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { SearchIcon } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  COLUNAS, INFO_AREA, ROTULO_COLUNA, colunaDa,
  type Area, type Coluna, type FiltroTarefas, type TarefaResumo,
} from "@/comum/tarefas"
import { chamarApi } from "@/frontend/api"
import { CartaoTarefa } from "@/frontend/tarefas/cartao-tarefa"
import { DetalheTarefa } from "@/frontend/tarefas/detalhe-tarefa"
import { NovaTarefaBotao } from "@/frontend/tarefas/nova-tarefa"
import { PendenciaDialogo } from "@/frontend/tarefas/pendencia-dialogo"

type Pessoa = { chave: string; nome: string; cor: string; iniciais: string }
type Props = {
  tarefas: TarefaResumo[]
  pessoas: Pessoa[]
  filtro: FiltroTarefas
  eu: string
  areas: Area[]                       // as que esta pessoa pode ver
  abertasPorArea: Partial<Record<Area, number>>
  diasConcluidas: number
}

// A cor de cada coluna é a do estado que ela representa
const COR_COLUNA: Record<Coluna, string> = {
  aberta: "bg-status-aberta",
  atrasada: "bg-status-atrasada",
  andamento: "bg-status-andamento",
  concluida: "bg-status-concluida",
  finalizada: "bg-status-finalizada",
}

export function CentralTarefas({ tarefas, pessoas, filtro, eu, areas, abertasPorArea, diasConcluidas }: Props) {
  const router = useRouter()
  const caminho = usePathname()
  const params = useSearchParams()
  const [carregando, iniciar] = useTransition()
  const [aberta, setAberta] = useState<number | null>(null)
  const [pendenciaDe, setPendenciaDe] = useState<TarefaResumo | null>(null)
  const [busca, setBusca] = useState(filtro.busca ?? "")
  const [arrastando, setArrastando] = useState<number | null>(null)
  const [sobre, setSobre] = useState<Coluna | null>(null)
  // Movimento otimista: o cartão muda de coluna na hora; se o servidor
  // recusar, ele volta e a pessoa vê o motivo
  const [movidas, setMovidas] = useState<Record<number, TarefaResumo["status"]>>({})

  function filtrar(mudanca: Record<string, string | undefined>) {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(mudanca)) {
      if (!v || v === "todos" || v === "todas") p.delete(k)
      else p.set(k, v)
    }
    iniciar(() => router.replace(`${caminho}${p.size ? "?" + p : ""}`, { scroll: false }))
  }

  // A busca espera a pessoa parar de digitar, para não ir ao banco por letra
  useEffect(() => {
    if (busca === (filtro.busca ?? "")) return
    const t = setTimeout(() => filtrar({ busca: busca.trim() || undefined }), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca])

  const colunas = useMemo(() => {
    const porColuna: Record<Coluna, TarefaResumo[]> = { aberta: [], atrasada: [], andamento: [], concluida: [], finalizada: [] }
    for (const t0 of tarefas) {
      const status = movidas[t0.id] ?? t0.status
      const feita = status === "concluida" || status === "finalizada"
      // Concluir tira do atraso; qualquer outro movimento não mexe no prazo
      const t = { ...t0, status, atrasada: feita ? false : t0.atrasada }
      porColuna[colunaDa(t)].push(t)
    }
    return porColuna
  }, [tarefas, movidas])

  async function mover(t: TarefaResumo, destino: Coluna) {
    if (destino === "atrasada") {
      toast.info("Atrasada não é uma etapa: a tarefa vai para lá sozinha quando o prazo passa.")
      return
    }
    if (destino === "andamento") { setPendenciaDe(t); return }   // pede o motivo antes
    if (destino === colunaDa(t) || destino === t.status) return
    setMovidas((m) => ({ ...m, [t.id]: destino }))
    try {
      await chamarApi(`/api/tarefas/${t.id}`, "PATCH", { status: destino })
      toast.success(`${ROTULO_COLUNA[destino]}: ${t.titulo}`)
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setMovidas((m) => { const n = { ...m }; delete n[t.id]; return n })
    }
  }

  async function excluir(t: TarefaResumo) {
    if (!window.confirm(`Excluir a tarefa "${t.titulo}"?\n\nEla sai do quadro, mas fica guardada com o registro de quem excluiu.`)) return
    try {
      await chamarApi(`/api/tarefas/${t.id}`, "DELETE")
      toast.success("Tarefa excluída")
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const totalAbertas = Object.values(abertasPorArea).reduce((a, b) => a + (b ?? 0), 0)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {filtro.area ? INFO_AREA[filtro.area].rotulo : "Central de Tarefas"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {filtro.area ? INFO_AREA[filtro.area].descricao : "Todas as áreas. Arraste um cartão para mudar a etapa."}
          </p>
        </div>
        <NovaTarefaBotao pessoas={pessoas} eu={eu} area={filtro.area ?? "diarias"} areas={areas} />
      </div>

      {/* Áreas: o mesmo recorte da Central de Tarefas atual */}
      <nav aria-label="Áreas" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <BotaoArea ativo={!filtro.area} rotulo="Todas" n={totalAbertas} onClick={() => filtrar({ area: undefined })} />
        {areas.map((a) => (
          <BotaoArea key={a} ativo={filtro.area === a} rotulo={INFO_AREA[a].rotulo} n={abertasPorArea[a] ?? 0} onClick={() => filtrar({ area: a })} />
        ))}
      </nav>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={filtro.responsavel ?? "todos"} onValueChange={(v) => filtrar({ responsavel: v })}>
          <SelectTrigger className="w-full bg-card sm:w-48" aria-label="Responsável"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os responsáveis</SelectItem>
            <SelectItem value={eu}>Minhas tarefas</SelectItem>
            {pessoas.filter((p) => p.chave !== eu).map((p) => (
              <SelectItem key={p.chave} value={p.chave}>{p.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative sm:w-72">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar tarefa…" className="bg-card pl-8" aria-label="Buscar tarefa" />
        </div>
      </div>

      {/* O quadro. No celular as colunas deslizam para o lado, uma por tela */}
      <div className={cn("-mx-4 overflow-x-auto px-4 pb-2 transition-opacity md:-mx-6 md:px-6", carregando && "opacity-60")}>
        <div className="grid snap-x snap-mandatory auto-cols-[minmax(17rem,85vw)] grid-flow-col gap-3 sm:auto-cols-[18rem] xl:auto-cols-fr">
          {COLUNAS.map((c) => {
            const lista = colunas[c]
            const podeSoltar = c !== "atrasada"
            return (
              <section
                key={c}
                aria-label={ROTULO_COLUNA[c]}
                onDragOver={(e) => { if (arrastando !== null && podeSoltar) { e.preventDefault(); setSobre(c) } }}
                onDragLeave={() => setSobre((s) => (s === c ? null : s))}
                onDrop={(e) => {
                  e.preventDefault(); setSobre(null)
                  const t = tarefas.find((x) => x.id === Number(e.dataTransfer.getData("text/plain")))
                  if (t) void mover({ ...t, status: movidas[t.id] ?? t.status }, c)
                }}
                className={cn(
                  "flex min-h-40 snap-start flex-col rounded-xl bg-coluna p-2 transition-colors",
                  sobre === c && "bg-primary/10 ring-2 ring-primary/40",
                  arrastando !== null && !podeSoltar && "opacity-60",
                )}
              >
                <header className="flex items-center gap-2 px-1.5 pt-1 pb-2.5">
                  <span className={cn("size-2 rounded-full", COR_COLUNA[c])} aria-hidden />
                  <h2 className="text-sm font-semibold">{ROTULO_COLUNA[c]}</h2>
                  <span className="rounded-full bg-background px-2 text-xs font-medium tabular-nums text-muted-foreground">{lista.length}</span>
                </header>
                <div className="flex flex-1 flex-col gap-2">
                  {lista.map((t) => (
                    <CartaoTarefa
                      key={t.id}
                      t={t}
                      mostrarArea={!filtro.area}
                      onAbrir={() => setAberta(t.id)}
                      onMover={mover}
                      onExcluir={() => excluir(t)}
                      arrastando={arrastando === t.id}
                      onArrastar={setArrastando}
                    />
                  ))}
                  {lista.length === 0 && (
                    <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                      {c === "atrasada" ? "Nada atrasado." : c === "concluida" || c === "finalizada" ? `Nada nos últimos ${diasConcluidas} dias.` : "Nenhuma tarefa aqui."}
                    </p>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </div>

      <DetalheTarefa key={aberta ?? "fechado"} id={aberta} pessoas={pessoas} onFechar={() => setAberta(null)} />
      <PendenciaDialogo tarefa={pendenciaDe} onFechar={() => setPendenciaDe(null)} />
    </div>
  )
}

function BotaoArea({ ativo, rotulo, n, onClick }: { ativo: boolean; rotulo: string; n: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
        ativo ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-card hover:border-primary/40 hover:bg-accent",
      )}
    >
      {rotulo}
      <span className={cn("rounded-full px-1.5 text-xs tabular-nums", ativo ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground")}>{n}</span>
    </button>
  )
}
