"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import type { TarefaResumo } from "@/comum/tarefas"
import { chamarApi } from "@/frontend/api"

// "Com Pendência" sempre diz qual é a pendência — o servidor também exige
export function PendenciaDialogo({ tarefa, onFechar }: { tarefa: TarefaResumo | null; onFechar: () => void }) {
  const router = useRouter()
  const [texto, setTexto] = useState("")
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!tarefa || !texto.trim()) return
    setEnviando(true)
    try {
      await chamarApi(`/api/tarefas/${tarefa.id}`, "PATCH", { status: "andamento", pendencia: texto.trim() })
      toast.success("Pendência registrada")
      setTexto("")
      onFechar()
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={!!tarefa} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <form onSubmit={salvar} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Marcar pendência</DialogTitle>
            <DialogDescription>{tarefa?.titulo} — o que está impedindo de concluir?</DialogDescription>
          </DialogHeader>
          <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} autoFocus aria-label="Pendência" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={enviando || !texto.trim()}>{enviando && <Loader2Icon className="animate-spin" />}Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
