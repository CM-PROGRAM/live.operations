"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { INFO_AREA, NovaTarefa, PRIORIDADES, ROTULO_PRIORIDADE, type Area, type Prioridade } from "@/comum/tarefas"
import { chamarApi } from "@/frontend/api"
import { EscolherPessoas } from "@/frontend/tarefas/escolher-pessoas"

type Pessoa = { chave: string; nome: string; cor: string; iniciais: string }

export function NovaTarefaBotao({ pessoas, eu, area: areaInicial, areas }: { pessoas: Pessoa[]; eu: string; area: Area; areas: Area[] }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [titulo, setTitulo] = useState("")
  const [descricao, setDescricao] = useState("")
  const [prioridade, setPrioridade] = useState<Prioridade>("normal")
  const [vencimento, setVencimento] = useState("")
  const [responsaveis, setResponsaveis] = useState<string[]>([eu])
  // A tarefa nasce na área que está aberta no quadro
  const [area, setArea] = useState<Area>(areaInicial)

  function limpar() {
    setTitulo(""); setDescricao(""); setPrioridade("normal"); setVencimento(""); setResponsaveis([eu]); setArea(areaInicial); setErros({})
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    // O mesmo contrato que o servidor usa: o erro aparece antes de enviar
    const dados = NovaTarefa.safeParse({ titulo, descricao, prioridade, vencimento: vencimento || null, responsaveis, area })
    if (!dados.success) {
      setErros(Object.fromEntries(dados.error.issues.map((i) => [String(i.path[0]), i.message])))
      return
    }
    setEnviando(true)
    try {
      await chamarApi("/api/tarefas", "POST", dados.data)
      toast.success("Tarefa criada")
      setAberto(false)
      limpar()
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); if (v) setArea(areaInicial); else setErros({}) }}>
      <DialogTrigger asChild>
        <Button><PlusIcon />Nova tarefa</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={salvar} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Nova tarefa</DialogTitle>
            <DialogDescription>Quem for escolhido vê a tarefa em &ldquo;Minhas tarefas&rdquo;.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="nt-titulo">Título</Label>
            <Input id="nt-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} aria-invalid={!!erros.titulo} autoFocus />
            {erros.titulo && <p className="text-sm text-destructive">{erros.titulo}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nt-desc">Descrição</Label>
            <Textarea id="nt-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="col-span-2 grid gap-2 sm:col-span-1">
              <Label>Área</Label>
              <Select value={area} onValueChange={(v) => setArea(v as Area)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {areas.map((a) => <SelectItem key={a} value={a}>{INFO_AREA[a].rotulo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Prioridade</Label>
              <Select value={prioridade} onValueChange={(v) => setPrioridade(v as Prioridade)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORIDADES.map((p) => <SelectItem key={p} value={p}>{ROTULO_PRIORIDADE[p]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nt-venc">Vencimento</Label>
              <Input id="nt-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Responsáveis</Label>
            <EscolherPessoas pessoas={pessoas} valor={responsaveis} onChange={setResponsaveis} />
            {erros.responsaveis && <p className="text-sm text-destructive">{erros.responsaveis}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button type="submit" disabled={enviando}>{enviando && <Loader2Icon className="animate-spin" />}Criar tarefa</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
