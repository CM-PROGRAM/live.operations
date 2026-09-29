import type { Metadata } from "next"
import { FormularioRedefinir } from "@/frontend/auth/formularios-senha"
import { TelaDeAcesso } from "@/frontend/auth/tela-de-acesso"

export const metadata: Metadata = { title: "Criar nova senha" }

export default async function PaginaRedefinir({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = (await searchParams).token
  return <TelaDeAcesso><FormularioRedefinir token={Array.isArray(t) ? t[0] ?? "" : t ?? ""} /></TelaDeAcesso>
}
