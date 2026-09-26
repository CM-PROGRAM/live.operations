"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, SendIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ROTULO_PRIORIDADE, ROTULO_STATUS, type TarefaDetalhe } from "@/comum/tarefas"
import { chamarApi } from "@/frontend/api"
import { EscolherPessoas } from "@/frontend/tarefas/escolher-pessoas"
import { dataCurta, dataHora, SeloPrioridade, SeloStatus } from "@/frontend/tarefas/pecas"

type Pessoa = { chave: string; nome: string; cor: string; iniciais: string }

const ROTULO_CAMPO: Record<string, string> = {
  titulo: "Título", descricao: "Descrição", prioridade: "Prioridade", vencimento: "Vencimento",
  status: "Status", pendencia: "Pendência", responsaveis: "Responsáveis",
}

export function DetalheTarefa({ id, pessoas, onFechar }: { id: number | null; pessoas: Pessoa[]; onFechar: () => void }) {
  const router = useRouter()
  const [t, setT] = useState<TarefaDetalhe | null>(null)
  const [erro, setErro] = useState("")
  const [comentario, setComentario] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [responsaveis, setResponsaveis] = useState<string[]>([])

  const carregar = useCallback(async (tid: number) => {
    try {
      const d = await chamarApi<TarefaDetalhe>(`/api/tarefas/${tid}`)
      setT(d)
      setErro("")
      setResponsaveis(d.responsaveis.map((r) => r.chave))
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [])

  // Cada tarefa aberta monta o painel do zero (key={id} na Central), então
  // aqui só falta buscar os dados.
  useEffect(() => {
    if (!id) return
    let vivo = true // a resposta de uma tarefa fechada não pode pintar a próxima
    chamarApi<TarefaDetalhe>(`/api/tarefas/${id}`).then(
      (d) => { if (vivo) { setT(d); setResponsaveis(d.responsaveis.map((r) => r.chave)) } },
      (e: Error) => { if (vivo) setErro(e.message) }
    )
    return () => { vivo = false }
  }, [id])

  async function comentar(e: React.FormEvent) {
    e.preventDefault()
    if (!t || !comentario.trim()) return
    setEnviando(true)
    try {
      await chamarApi(`/api/tarefas/${t.id}/comentarios`, "POST", { texto: comentario.trim() })
      setComentario("")
      await carregar(t.id)
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  async function salvarResponsaveis() {
    if (!t) return
    try {
      await chamarApi(`/api/tarefas/${t.id}`, "PATCH", { responsaveis })
      toast.success("Responsáveis atualizados")
      await carregar(t.id)
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const mudouResponsaveis = t && [...responsaveis].sort().join() !== t.responsaveis.map((r) => r.chave).sort().join()

  return (
    <Sheet open={id !== null} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="pr-6">{t?.titulo ?? (erro ? "Tarefa" : <Skeleton className="h-6 w-3/4" />)}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              {t && <SeloStatus status={t.status} atrasada={t.atrasada} />}
              {t && <SeloPrioridade prioridade={t.prioridade} />}
            </div>
          </SheetDescription>
        </SheetHeader>

        {erro && <p className="px-4 text-sm text-destructive">{erro}</p>}
        {!t && !erro && <div className="grid gap-3 px-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>}

        {t && (
          <div className="grid gap-5 px-4 pb-6 text-sm">
            {t.status === "andamento" && t.pendencia && (
              <div className="rounded-md border border-status-andamento/30 bg-status-andamento/10 p-3">
                <div className="text-xs font-medium text-status-andamento">Pendência</div>
                <p className="whitespace-pre-wrap">{t.pendencia}</p>
              </div>
            )}
            {t.descricao && <p className="whitespace-pre-wrap text-muted-foreground">{t.descricao}</p>}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Campo rotulo="Vencimento">{dataCurta(t.vencimento)}</Campo>
              <Campo rotulo="Criada em">{dataHora(t.criado_em)}</Campo>
              {t.concluido_em && <Campo rotulo="Concluída em">{dataHora(t.concluido_em)}</Campo>}
              {t.concluido_por && <Campo rotulo="Concluída por">{t.concluido_por}</Campo>}
              {t.origem && t.origem !== "manual" && <Campo rotulo="Origem">{t.origem}</Campo>}
            </dl>

            <div className="grid gap-2">
              <div className="text-xs font-medium text-muted-foreground">Responsáveis</div>
              <EscolherPessoas pessoas={pessoas} valor={responsaveis} onChange={setResponsaveis} />
              {mudouResponsaveis && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={salvarResponsaveis} disabled={!responsaveis.length}>Salvar responsáveis</Button>
                  <Button size="sm" variant="ghost" onClick={() => setResponsaveis(t.responsaveis.map((r) => r.chave))}>Desfazer</Button>
                </div>
              )}
            </div>

            <Separator />

            <section className="grid gap-3" aria-label="Comentários">
              <h3 className="font-medium">Comentários</h3>
              {t.comentariosLista.length === 0 && <p className="text-muted-foreground">Nenhum comentário ainda.</p>}
              {t.comentariosLista.map((c) => (
                <div key={c.id} className="rounded-md bg-muted p-3">
                  <div className="mb-1 text-xs text-muted-foreground">{c.autor ?? "—"} · {dataHora(c.criado_em)}</div>
                  <p className="whitespace-pre-wrap">{c.texto}</p>
                </div>
              ))}
              <form onSubmit={comentar} className="flex items-end gap-2">
                <Textarea value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Escreva um comentário…" rows={2} aria-label="Novo comentário" />
                <Button type="submit" size="icon" disabled={enviando || !comentario.trim()} aria-label="Enviar comentário">
                  {enviando ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                </Button>
              </form>
            </section>

            <Separator />

            <section className="grid gap-2" aria-label="Histórico">
              <h3 className="font-medium">Histórico</h3>
              {t.historico.length === 0 && <p className="text-muted-foreground">Sem registros no sistema novo ainda.</p>}
              <ol className="grid gap-2 border-l pl-4">
                {t.historico.map((h, i) => (
                  <li key={i} className="text-xs">
                    <span className="text-muted-foreground">{dataHora(h.em)} · {h.autor ?? "—"}</span>
                    <div>
                      {h.evento === "criado" && "Criou a tarefa"}
                      {h.evento === "excluido" && "Excluiu a tarefa"}
                      {h.evento === "editado" && (
                        <>{ROTULO_CAMPO[h.campo ?? ""] ?? h.campo}: <s className="text-muted-foreground">{valorLegivel(h.campo, h.de)}</s> → {valorLegivel(h.campo, h.para)}</>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// O banco guarda "andamento"; a pessoa lê "Com Pendência"
function valorLegivel(campo: string | null, v: string | null) {
  if (!v) return "—"
  if (campo === "status") return (ROTULO_STATUS as Record<string, string>)[v]?.replace(/s$/, "") ?? v
  if (campo === "prioridade") return (ROTULO_PRIORIDADE as Record<string, string>)[v] ?? v
  if (campo === "vencimento") return dataCurta(v)
  return v
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  )
}
