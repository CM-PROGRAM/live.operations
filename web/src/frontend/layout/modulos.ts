import {
  ArchiveRestoreIcon, BanIcon, BoxesIcon, HeadsetIcon, ListChecksIcon, MegaphoneIcon,
  MessageCircleIcon, ShieldIcon, ShoppingBagIcon, TruckIcon, type LucideIcon,
} from "lucide-react"

/* Os módulos do LiveOps. `href` = já migrado para o sistema novo; os
   outros abrem o sistema atual, que segue no ar durante a migração —
   um módulo por vez, sem dia de virada em que tudo muda junto. */
export type Modulo = { titulo: string; icone: LucideIcon; permissao: string; href?: string }

export const MODULOS: Modulo[] = [
  { titulo: "Tarefas", icone: ListChecksIcon, permissao: "tarefas", href: "/tarefas" },
  { titulo: "Vendas", icone: ShoppingBagIcon, permissao: "envios" },
  { titulo: "Canceladas", icone: BanIcon, permissao: "tarefas" },
  { titulo: "Devoluções", icone: ArchiveRestoreIcon, permissao: "devolucoes" },
  { titulo: "Atendimentos", icone: HeadsetIcon, permissao: "atendimentos" },
  { titulo: "Estoque", icone: BoxesIcon, permissao: "base" },
  { titulo: "Compras", icone: TruckIcon, permissao: "admin" },
  { titulo: "Anúncios", icone: MegaphoneIcon, permissao: "integracoes" },
  { titulo: "WhatsLive", icone: MessageCircleIcon, permissao: "whatsapp" },
  { titulo: "Administrador", icone: ShieldIcon, permissao: "admin" },
]

export const SISTEMA_ATUAL_URL =
  process.env.NEXT_PUBLIC_SISTEMA_ATUAL_URL || "https://cm-program.github.io/live.operations/"
