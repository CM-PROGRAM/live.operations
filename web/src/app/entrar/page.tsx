import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { usuarioAtual } from "@/backend/auth/sessao"
import { FormularioEntrar } from "@/frontend/auth/formulario-entrar"
import { TelaDeAcesso } from "@/frontend/auth/tela-de-acesso"

export const metadata: Metadata = { title: "Entrar" }

export default async function PaginaEntrar() {
  if (await usuarioAtual()) redirect("/tarefas")
  return (
    <TelaDeAcesso>
      <FormularioEntrar />
    </TelaDeAcesso>
  )
}
