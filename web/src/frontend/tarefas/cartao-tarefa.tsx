"use client"

import { AlertTriangleIcon, CalendarIcon, CheckCircle2Icon, CircleDotIcon, MessageSquareIcon, MoreHorizontalIcon,
  PauseCircleIcon, RotateCcwIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { INFO_AREA, type Coluna, type TarefaResumo } from "@/comum/tarefas"
import { dataCurta, Responsaveis } from "@/frontend/tarefas/pecas"

export type Mover = (t: TarefaResumo, destino: Coluna) => void

// "Vence hoje" pede atenção antes de virar atraso; o resto é só a data
function hojeISO() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })
}

export function CartaoTarefa({
  t, mostrarArea, onAbrir, onMover, onExcluir, arrastando, onArrastar,
}: {
  t: TarefaResumo
  mostrarArea: boolean
  onAbrir: () => void
  onMover: Mover
  onExcluir: () => void
  arrastando: boolean
  onArrastar: (id: number | null) => void
}) {
  const feita = t.status === "concluida" || t.status === "finalizada"
  const venceHoje = !feita && !t.atrasada && t.vencimento === hojeISO()

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(t.id))
        e.dataTransfer.effectAllowed = "move"
        onArrastar(t.id)
      }}
      onDragEnd={() => onArrastar(null)}
      onClick={onAbrir}
      onKeyDown={(e) => { if (e.key === "Enter") onAbrir() }}
      tabIndex={0}
      aria-label={t.titulo}
      className={cn(
        "group relative cursor-pointer rounded-lg border bg-card p-3 text-card-foreground shadow-xs transition",
        "hover:-translate-y-px hover:border-primary/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring",
        t.prioridade === "urgente" && !feita && "border-destructive/40",
        arrastando && "rotate-1 opacity-50",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {(mostrarArea || t.prioridade !== "normal") && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              {t.prioridade === "urgente" && !feita && (
                <span className="inline-flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
                  <AlertTriangleIcon className="size-3" />Urgente
                </span>
              )}
              {t.prioridade === "alta" && !feita && (
                <span className="rounded bg-status-andamento/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-status-andamento uppercase">Alta</span>
              )}
              {mostrarArea && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  {INFO_AREA[t.area].rotulo}
                </span>
              )}
            </div>
          )}
          <h3 className={cn("line-clamp-2 text-sm leading-snug font-medium", feita && "text-muted-foreground line-through decoration-1")}>
            {t.titulo}
          </h3>
        </div>
        <MenuDoCartao t={t} onMover={onMover} onExcluir={onExcluir} />
      </div>

      {t.status === "andamento" && t.pendencia ? (
        <p className="mt-2 line-clamp-2 flex gap-1.5 rounded-md bg-status-andamento/10 px-2 py-1.5 text-xs text-status-andamento">
          <PauseCircleIcon className="mt-px size-3.5 shrink-0" />{t.pendencia}
        </p>
      ) : t.descricao ? (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.descricao}</p>
      ) : null}

      <div className="mt-3 flex items-center gap-2 text-xs">
        {t.vencimento && (
          <span className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 tabular-nums",
            t.atrasada ? "bg-status-atrasada/12 font-medium text-status-atrasada"
              : venceHoje ? "bg-status-andamento/15 font-medium text-status-andamento"
              : "text-muted-foreground",
          )}>
            <CalendarIcon className="size-3" />
            {venceHoje ? "Hoje" : dataCurta(t.vencimento)}
          </span>
        )}
        {t.comentarios > 0 && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <MessageSquareIcon className="size-3" />{t.comentarios}
          </span>
        )}
        {feita && t.concluido_por && (
          <span className="inline-flex min-w-0 items-center gap-1 truncate text-status-concluida">
            <CheckCircle2Icon className="size-3 shrink-0" />{t.concluido_por}
          </span>
        )}
        <div className="ml-auto"><Responsaveis lista={t.responsaveis} max={3} /></div>
      </div>
    </article>
  )
}

/* Arrastar não existe no celular; o menu faz o mesmo em qualquer tela */
function MenuDoCartao({ t, onMover, onExcluir }: { t: TarefaResumo; onMover: Mover; onExcluir: () => void }) {
  const feita = t.status === "concluida" || t.status === "finalizada"
  return (
    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="-mt-1 -mr-1 size-7 text-muted-foreground opacity-60 group-hover:opacity-100" aria-label={`Ações de ${t.titulo}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Mover para</DropdownMenuLabel>
          {!feita && <DropdownMenuItem onClick={() => onMover(t, "concluida")}><CheckCircle2Icon />Concluída</DropdownMenuItem>}
          {!feita && t.status !== "andamento" && <DropdownMenuItem onClick={() => onMover(t, "andamento")}><PauseCircleIcon />Com Pendência</DropdownMenuItem>}
          {t.status === "andamento" && <DropdownMenuItem onClick={() => onMover(t, "aberta")}><CircleDotIcon />A Fazer (pendência resolvida)</DropdownMenuItem>}
          {t.status === "concluida" && <DropdownMenuItem onClick={() => onMover(t, "finalizada")}><CheckCircle2Icon />Finalizada</DropdownMenuItem>}
          {feita && <DropdownMenuItem onClick={() => onMover(t, "aberta")}><RotateCcwIcon />Reabrir</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onExcluir}><Trash2Icon />Excluir</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
