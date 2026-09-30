"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeftIcon, Loader2Icon, MailCheckIcon, CheckCircle2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NovaSenha, Redefinicao } from "@/comum/senha"

async function postar(url: string, corpo: unknown) {
  let r: Response
  try {
    r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) })
  } catch {
    throw new Error("Sem conexão com o servidor. Tente de novo.")
  }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || "Não foi possível concluir.")
}

function Voltar() {
  return (
    <Link href="/entrar" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeftIcon className="size-4" />Voltar para o login
    </Link>
  )
}

export function FormularioEsqueci() {
  const [email, setEmail] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState("")
  const [pronto, setPronto] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setEnviando(true); setErro("")
    try { await postar("/api/auth/esqueci", { email }); setPronto(true) }
    catch (err) { setErro((err as Error).message) }
    finally { setEnviando(false) }
  }

  if (pronto) {
    return (
      <div className="grid gap-5">
        <MailCheckIcon className="size-10 text-primary" />
        <div className="grid gap-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">Confira seu e-mail</h2>
          <p className="text-sm text-muted-foreground">
            Se <strong className="text-foreground">{email}</strong> tiver uma conta, chega em alguns minutos um link para criar a nova senha.
            O link vale por 1 hora. Olhe também a caixa de spam.
          </p>
        </div>
        <Voltar />
      </div>
    )
  }
  return (
    <form onSubmit={enviar} className="grid gap-6">
      <div className="grid gap-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Esqueci minha senha</h2>
        <p className="text-sm text-muted-foreground">Informe o e-mail da sua conta. Enviamos um link para você criar uma senha nova.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@suplelive.com.br" required autoFocus />
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <Button type="submit" disabled={enviando} className="h-10">{enviando && <Loader2Icon className="animate-spin" />}Enviar link</Button>
      <Voltar />
    </form>
  )
}

export function FormularioRedefinir({ token }: { token: string }) {
  const [nova, setNova] = useState("")
  const [confirmacao, setConfirmacao] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState("")
  const [pronto, setPronto] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    const d = Redefinicao.safeParse({ token, nova, confirmacao })
    if (!d.success) { setErro(d.error.issues[0]?.message ?? "Confira os campos"); return }
    setEnviando(true); setErro("")
    try { await postar("/api/auth/redefinir", d.data); setPronto(true) }
    catch (err) { setErro((err as Error).message) }
    finally { setEnviando(false) }
  }

  if (!token) {
    return (
      <div className="grid gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">Link incompleto</h2>
        <p className="text-sm text-muted-foreground">Abra o link direto do e-mail, sem cortar nenhuma parte, ou peça um novo.</p>
        <Link href="/esqueci" className="text-sm text-primary hover:underline">Pedir um novo link</Link>
      </div>
    )
  }
  if (pronto) {
    return (
      <div className="grid gap-5">
        <CheckCircle2Icon className="size-10 text-status-concluida" />
        <div className="grid gap-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">Senha criada</h2>
          <p className="text-sm text-muted-foreground">Por segurança, você saiu de todos os aparelhos. Entre de novo com a senha nova.</p>
        </div>
        <Button asChild className="h-10"><Link href="/entrar">Entrar</Link></Button>
      </div>
    )
  }
  const curta = nova.length > 0 && !NovaSenha.safeParse(nova).success
  return (
    <form onSubmit={enviar} className="grid gap-6">
      <div className="grid gap-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Criar nova senha</h2>
        <p className="text-sm text-muted-foreground">Use pelo menos 8 caracteres.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="nova">Nova senha</Label>
        <Input id="nova" type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} aria-invalid={curta} required autoFocus />
        {curta && <p className="text-xs text-muted-foreground">Faltam {8 - nova.length} caractere(s).</p>}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirmacao">Repita a nova senha</Label>
        <Input id="confirmacao" type="password" autoComplete="new-password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} required />
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <Button type="submit" disabled={enviando} className="h-10">{enviando && <Loader2Icon className="animate-spin" />}Salvar nova senha</Button>
      <Voltar />
    </form>
  )
}
