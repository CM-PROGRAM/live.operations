import {
  ArchiveRestoreIcon, BanIcon, BoxesIcon, HeadsetIcon, ListChecksIcon, MegaphoneIcon,
  MessageCircleIcon, ShieldIcon, ShoppingBagIcon, TruckIcon, type LucideIcon,
} from "lucide-react"

/* Os módulos do LiveOps. `href` = já existe no sistema novo; os outros
   aparecem como "em breve" até serem construídos (o sistema antigo foi
   desligado em 28/09/2026). */
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
