import {
  ArchiveRestoreIcon, BanIcon, BoxesIcon, HeadsetIcon, ListChecksIcon, MegaphoneIcon,
  MessageCircleIcon, ShieldIcon, ShoppingBagIcon, TruckIcon, type LucideIcon,
} from "lucide-react"

/* Os módulos do Live Operations. `href` = já construído; os outros
   aparecem como "em breve" na barra lateral. */
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
