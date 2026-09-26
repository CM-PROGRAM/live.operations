import { AlertTriangleIcon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ROTULO_PRIORIDADE, ROTULO_STATUS, type Prioridade, type Status, type TarefaResumo } from "@/comum/tarefas"

const COR_STATUS: Record<Status | "atrasada", string> = {
  aberta: "bg-status-aberta/12 text-status-aberta border-status-aberta/25",
  andamento: "bg-status-andamento/15 text-status-andamento border-status-andamento/30",
  atrasada: "bg-status-atrasada/12 text-status-atrasada border-status-atrasada/25",
  concluida: "bg-status-concluida/12 text-status-concluida border-status-concluida/25",
  finalizada: "bg-status-finalizada/12 text-status-finalizada border-status-finalizada/25",
}

export function SeloStatus({ status, atrasada }: { status: Status; atrasada?: boolean }) {
  const chave = atrasada ? "atrasada" : status
  const rotulo = atrasada ? "Atrasada" : ROTULO_STATUS[status].replace(/s$/, "")
  return <Badge variant="outline" className={cn("font-medium", COR_STATUS[chave])}>{rotulo}</Badge>
}

export function SeloPrioridade({ prioridade }: { prioridade: Prioridade }) {
  if (prioridade === "normal") return <span className="text-sm text-muted-foreground">Normal</span>
  return (
    <Badge variant={prioridade === "urgente" ? "destructive" : "secondary"} className="gap-1">
      {prioridade === "urgente" && <AlertTriangleIcon className="size-3" />}
      {ROTULO_PRIORIDADE[prioridade]}
    </Badge>
  )
}

export function Responsaveis({ lista, max = 3 }: { lista: TarefaResumo["responsaveis"]; max?: number }) {
  if (!lista.length) return <span className="text-sm text-muted-foreground">—</span>
  return (
    <div className="flex -space-x-2">
      {lista.slice(0, max).map((r) => (
        <Tooltip key={r.chave}>
          <TooltipTrigger asChild>
            <Avatar className="size-7 border-2 border-background">
              <AvatarFallback className="text-[10px] font-semibold text-white" style={{ background: r.cor }}>{r.iniciais}</AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent>{r.nome}</TooltipContent>
        </Tooltip>
      ))}
      {lista.length > max && (
        <Avatar className="size-7 border-2 border-background">
          <AvatarFallback className="text-[10px]">+{lista.length - max}</AvatarFallback>
        </Avatar>
      )}
    </div>
  )
}

// "2026-09-26" → "26/09" (ou "26/09/2025" se não for deste ano)
export function dataCurta(iso: string | null) {
  if (!iso) return "—"
  const [a, m, d] = iso.slice(0, 10).split("-")
  return a === String(new Date().getFullYear()) ? `${d}/${m}` : `${d}/${m}/${a}`
}

export function dataHora(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}
