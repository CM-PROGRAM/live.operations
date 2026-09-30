import type { Metadata } from "next"
import { FormularioEsqueci } from "@/frontend/auth/formularios-senha"
import { TelaDeAcesso } from "@/frontend/auth/tela-de-acesso"

export const metadata: Metadata = { title: "Esqueci minha senha" }

export default function PaginaEsqueci() {
  return <TelaDeAcesso><FormularioEsqueci /></TelaDeAcesso>
}
