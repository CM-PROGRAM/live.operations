"use client"

import { useEffect, useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  CheckCircle2Icon, CircleDotIcon, ClockAlertIcon, ListTodoIcon, MessageSquareIcon, MoreHorizontalIcon,
  PauseCircleIcon, RotateCcwIcon, SearchIcon, Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { FILTROS_STATUS, ROTULO_STATUS, type FiltroStatus, type FiltroTarefas, type TarefaResumo } from "@/comum/tarefas"
import { chamarApi } from "@/frontend/api"
import { dataCurta, Responsaveis, SeloPrioridade, SeloStatus } from "@/frontend/tarefas/pecas"
import { NovaTarefaBotao } from "@/frontend/tarefas/nova-tarefa"
import { DetalheTarefa } from "@/frontend/tarefas/detalhe-tarefa"
import { PendenciaDialogo } from "@/frontend/tarefas/pendencia-dialogo"

type Pessoa = { chave: string; nome: string; cor: string; iniciais: string }
type Props = {
  tarefas: TarefaResumo[]
  contagem: Record<FiltroStatus, number>
  pessoas: Pessoa[]
  filtro: FiltroTarefas
  eu: string
}

const CARTOES: { status: FiltroStatus; icone: typeof ListTodoIcon; cor: string }[] = [
  { status: "aberta", icone: ListTodoIcon, cor: "text-status-aberta" },
  { status: "andamento", icone: PauseCircleIcon, cor: "text-status-andamento" },
  { status: "atrasada", icone: ClockAlertIcon, cor: "text-status-atrasada" },
  { status: "concluida", icone: CheckCircle2Icon, cor: "text-status-concluida" },
]

export function CentralTarefas({ tarefas, contagem, pessoas, filtro, eu }: Props) {
  const router = useRouter()
  const caminho = usePathname()
  const params = useSearchParams()
  const [carregando, iniciar] = useTransition()
  const [aberta, setAberta] = useState<number | null>(null)
  const [pendenciaDe, setPendenciaDe] = useState<TarefaResumo | null>(null)
  const [busca, setBusca] = useState(filtro.busca ?? "")

  function filtrar(mudanca: Record<string, string | undefined>) {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(mudanca)) {
      if (!v || v === "todas" || v === "todos") p.delete(k)
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

  async function mudarStatus(t: TarefaResumo, status: TarefaResumo["status"], rotulo: string) {
    try {
      await chamarApi(`/api/tarefas/${t.id}`, "PATCH", { status })
      toast.success(`${rotulo}: ${t.titulo}`)
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function excluir(t: TarefaResumo) {
    if (!confirm(`Excluir a tarefa "${t.titulo}"?\n\nEla sai da tela, mas fica guardada com o registro de quem excluiu.`)) return
    try {
      await chamarApi(`/api/tarefas/${t.id}`, "DELETE")
      toast.success("Tarefa excluída")
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Central de Tarefas</h1>
          <p className="text-sm text-muted-foreground">O que cada um tem para fazer, e o que já foi feito.</p>
        </div>
        <NovaTarefaBotao pessoas={pessoas} eu={eu} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {CARTOES.map(({ status, icone: Icone, cor }) => (
          <button key={status} type="button" onClick={() => filtrar({ status })} className="text-left">
            <Card className={cn("gap-2 py-4 transition-colors hover:bg-accent/50", filtro.status === status && "ring-2 ring-ring")}>
              <CardHeader className="px-4">
                <CardDescription className="flex items-center gap-2">
                  <Icone className={cn("size-4", cor)} />
                  {ROTULO_STATUS[status]}
                </CardDescription>
                <CardTitle className="text-3xl tabular-nums">{contagem[status]}</CardTitle>
              </CardHeader>
            </Card>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs value={filtro.status} onValueChange={(v) => filtrar({ status: v })} className="overflow-x-auto">
          <TabsList>
            {FILTROS_STATUS.map((s) => (
              <TabsTrigger key={s} value={s} className="gap-1.5">
                {ROTULO_STATUS[s]}
                <span className="rounded bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{contagem[s]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex gap-2">
          <Select value={filtro.responsavel ?? "todos"} onValueChange={(v) => filtrar({ responsavel: v })}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Responsável" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value={eu}>Minhas tarefas</SelectItem>
              {pessoas.filter((p) => p.chave !== eu).map((p) => (
                <SelectItem key={p.chave} value={p.chave}>{p.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1 md:w-64">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar tarefa…" className="pl-8" aria-label="Buscar tarefa" />
          </div>
        </div>
      </div>

      <Card className={cn("overflow-hidden py-0 transition-opacity", carregando && "opacity-60")}>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="pl-4">Tarefa</TableHead>
              <TableHead className="hidden md:table-cell">Responsáveis</TableHead>
              <TableHead className="hidden sm:table-cell">Prioridade</TableHead>
              <TableHead className="hidden sm:table-cell">Vence</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="w-10"><span className="sr-only">Ações</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tarefas.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                  Nenhuma tarefa neste filtro.
                </TableCell>
              </TableRow>
            )}
            {tarefas.map((t) => {
              const feita = t.status === "concluida" || t.status === "finalizada"
              return (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => setAberta(t.id)}>
                  <TableCell className="max-w-0 pl-4 md:w-[45%]">
                    <div className={cn("truncate font-medium", feita && "text-muted-foreground line-through decoration-1")}>{t.titulo}</div>
                    <div className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                      {t.comentarios > 0 && (
                        <span className="flex shrink-0 items-center gap-0.5"><MessageSquareIcon className="size-3" />{t.comentarios}</span>
                      )}
                      <span className="truncate">{t.status === "andamento" && t.pendencia ? `Pendência: ${t.pendencia}` : t.descricao}</span>
                    </div>
                    {/* No celular, status e prazo descem para cá e o título fica com a largura toda */}
                    <div className="mt-1.5 flex items-center gap-2 sm:hidden">
                      <SeloStatus status={t.status} atrasada={t.atrasada} />
                      <span className={cn("text-xs tabular-nums", t.atrasada ? "font-medium text-status-atrasada" : "text-muted-foreground")}>
                        {t.vencimento && `vence ${dataCurta(t.vencimento)}`}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell"><Responsaveis lista={t.responsaveis} /></TableCell>
                  <TableCell className="hidden sm:table-cell"><SeloPrioridade prioridade={t.prioridade} /></TableCell>
                  <TableCell className={cn("hidden tabular-nums sm:table-cell", t.atrasada && "font-medium text-status-atrasada")}>{dataCurta(t.vencimento)}</TableCell>
                  <TableCell className="hidden sm:table-cell"><SeloStatus status={t.status} atrasada={t.atrasada} /></TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label={`Ações de ${t.titulo}`}>
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!feita && <DropdownMenuItem onClick={() => mudarStatus(t, "concluida", "Concluída")}><CheckCircle2Icon />Concluir</DropdownMenuItem>}
                        {!feita && t.status !== "andamento" && <DropdownMenuItem onClick={() => setPendenciaDe(t)}><PauseCircleIcon />Marcar pendência</DropdownMenuItem>}
                        {t.status === "andamento" && <DropdownMenuItem onClick={() => mudarStatus(t, "aberta", "Pendência resolvida")}><CircleDotIcon />Resolver pendência</DropdownMenuItem>}
                        {t.status === "concluida" && <DropdownMenuItem onClick={() => mudarStatus(t, "finalizada", "Finalizada")}><CheckCircle2Icon />Finalizar</DropdownMenuItem>}
                        {feita && <DropdownMenuItem onClick={() => mudarStatus(t, "aberta", "Reaberta")}><RotateCcwIcon />Reabrir</DropdownMenuItem>}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => excluir(t)}><Trash2Icon />Excluir</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>
      {tarefas.length >= 300 && (
        <p className="text-center text-xs text-muted-foreground">Mostrando as 300 primeiras. Use os filtros para achar o resto.</p>
      )}

      <DetalheTarefa key={aberta ?? "fechado"} id={aberta} pessoas={pessoas} onFechar={() => setAberta(null)} />
      <PendenciaDialogo tarefa={pendenciaDe} onFechar={() => setPendenciaDe(null)} />
    </>
  )
}
