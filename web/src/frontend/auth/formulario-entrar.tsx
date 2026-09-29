"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function FormularioEntrar() {
  const router = useRouter()
  const [erro, setErro] = useState("")
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setEnviando(true)
    setErro("")
    try {
      const r = await fetch("/api/auth/entrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario: f.get("usuario"), senha: f.get("senha") }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || "Não foi possível entrar.")
      router.replace("/tarefas")
      router.refresh()
    } catch (e) {
      setErro(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Sem conexão com o servidor.")
      setEnviando(false)
    }
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Entrar</h2>
        <p className="text-sm text-muted-foreground">Use o seu e-mail da Suplelive e a sua senha.</p>
      </div>
        <form onSubmit={enviar} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="usuario">E-mail</Label>
            <Input id="usuario" name="usuario" type="text" autoComplete="username" placeholder="voce@suplelive.com.br" required autoFocus />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="senha">Senha</Label>
              <Link href="/esqueci" className="text-sm text-primary underline-offset-4 hover:underline">Esqueci minha senha</Link>
            </div>
            <Input id="senha" name="senha" type="password" autoComplete="current-password" required />
          </div>
          {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
          <Button type="submit" disabled={enviando} className="h-10 w-full">
            {enviando && <Loader2Icon className="animate-spin" />}
            Entrar
          </Button>
        </form>
    </div>
  )
}
