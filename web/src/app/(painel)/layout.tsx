import { cookies } from "next/headers"
import { exigirUsuario } from "@/backend/auth/sessao"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { BarraLateral } from "@/frontend/layout/barra-lateral"

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const u = await exigirUsuario()
  // A barra lateral lembra se foi recolhida (cookie gravado pelo shadcn)
  const aberta = (await cookies()).get("sidebar_state")?.value !== "false"
  return (
    <SidebarProvider defaultOpen={aberta}>
      <BarraLateral usuario={{ nome: u.nome, email: u.email, cor: u.cor, iniciais: u.iniciais, master: u.master, permissoes: u.permissoes }} />
      {/* min-w-0: sem ele o conteúdo não encolhe ao lado da barra lateral, e
          a tabela empurrava a página para fora da tela abaixo de 1440 px */}
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <span className="text-sm text-muted-foreground">LiveOps</span>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
