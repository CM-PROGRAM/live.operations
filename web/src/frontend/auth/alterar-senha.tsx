"use client"

import { useState } from "react"
import { Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TrocaDeSenha } from "@/comum/senha"

/* Trocar a senha de quem já está logado. As outras sessões da conta são
   encerradas pelo servidor; esta continua aberta. */
export function AlterarSenha({ aberto, aoMudar }: { aberto: boolean; aoMudar: (v: boolean) => void }) {
  return (
    <Dialog open={aberto} onOpenChange={aoMudar}>
      <DialogContent className="sm:max-w-md">
        {/* Só montado aberto: fechar e abrir de novo começa com o formulário limpo */}
        {aberto && <Formulario aoTerminar={() => aoMudar(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function Formulario({ aoTerminar }: { aoTerminar: () => void }) {
  const [atual, setAtual] = useState("")
  const [nova, setNova] = useState("")
  const [confirmacao, setConfirmacao] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState("")

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    const lido = TrocaDeSenha.safeParse({ atual, nova, confirmacao })
    if (!lido.success) { setErro(lido.error.issues[0].message); return }
    setEnviando(true); setErro("")
    try {
      const r = await fetch("/api/auth/senha", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lido.data),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j.erro || "Não foi possível trocar a senha."); return }
      toast.success("Senha alterada. As outras sessões abertas foram encerradas.")
      aoTerminar()
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>Alterar minha senha</DialogTitle>
        <DialogDescription>A nova senha precisa ter pelo menos 8 caracteres.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="senha-atual">Senha atual</Label>
        <Input id="senha-atual" type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} required autoFocus />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="senha-nova">Nova senha</Label>
        <Input id="senha-nova" type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="senha-confirmacao">Repita a nova senha</Label>
        <Input id="senha-confirmacao" type="password" autoComplete="new-password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} required />
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={aoTerminar}>Cancelar</Button>
        <Button type="submit" disabled={enviando}>{enviando && <Loader2Icon className="animate-spin" />}Salvar senha</Button>
      </DialogFooter>
    </form>
  )
}
