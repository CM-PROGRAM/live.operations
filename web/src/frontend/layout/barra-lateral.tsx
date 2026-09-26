"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ExternalLinkIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon, ChevronsUpDownIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar,
} from "@/components/ui/sidebar"
import { MODULOS, SISTEMA_ATUAL_URL } from "@/frontend/layout/modulos"

export type UsuarioDaTela = { nome: string; email: string; cor: string; iniciais: string; master: boolean; permissoes: string[] }

export function BarraLateral({ usuario }: { usuario: UsuarioDaTela }) {
  const caminho = usePathname()
  const visiveis = MODULOS.filter((m) => usuario.master || usuario.permissoes.includes(m.permissao))
  const novos = visiveis.filter((m) => m.href)
  const antigos = visiveis.filter((m) => !m.href)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/tarefas">
                <Image src="/logo.png" alt="" width={32} height={32} className="rounded-md" />
                <div className="grid flex-1 text-left leading-tight">
                  <span className="font-semibold">LiveOps</span>
                  <span className="text-xs text-muted-foreground">Suplelive</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {novos.map((m) => (
                <SidebarMenuItem key={m.titulo}>
                  <SidebarMenuButton asChild isActive={caminho.startsWith(m.href!)} tooltip={m.titulo}>
                    <Link href={m.href!}><m.icone /><span>{m.titulo}</span></Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {antigos.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>No sistema atual</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {antigos.map((m) => (
                  <SidebarMenuItem key={m.titulo}>
                    <SidebarMenuButton asChild tooltip={`${m.titulo} (sistema atual)`} className="text-muted-foreground">
                      <a href={SISTEMA_ATUAL_URL} target="_blank" rel="noopener">
                        <m.icone /><span>{m.titulo}</span>
                        <ExternalLinkIcon className="ml-auto size-3 opacity-60" />
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <MenuDoUsuario usuario={usuario} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function MenuDoUsuario({ usuario }: { usuario: UsuarioDaTela }) {
  const router = useRouter()
  const { isMobile } = useSidebar()
  const { setTheme } = useTheme()

  async function sair() {
    await fetch("/api/auth/sair", { method: "POST" }).catch(() => {})
    router.replace("/entrar")
    router.refresh()
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg text-xs font-semibold text-white" style={{ background: usuario.cor }}>
                  {usuario.iniciais}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{usuario.nome}</span>
                <span className="truncate text-xs text-muted-foreground">{usuario.email}</span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" className="min-w-56">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Tema</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setTheme("light")}><SunIcon />Claro</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}><MoonIcon />Escuro</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}><MonitorIcon />Igual ao sistema</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={sair}><LogOutIcon />Sair</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
