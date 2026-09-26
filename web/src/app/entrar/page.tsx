import type { Metadata } from "next"
import Image from "next/image"
import { redirect } from "next/navigation"
import { usuarioAtual } from "@/backend/auth/sessao"
import { FormularioEntrar } from "@/frontend/auth/formulario-entrar"

export const metadata: Metadata = { title: "Entrar" }

export default async function PaginaEntrar() {
  if (await usuarioAtual()) redirect("/tarefas")
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6">
      <div className="flex items-center gap-3">
        <Image src="/logo.png" alt="" width={40} height={40} priority />
        <span className="text-xl font-semibold tracking-tight">LiveOps</span>
      </div>
      <FormularioEntrar />
    </main>
  )
}
