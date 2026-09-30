import { CheckCircle2Icon } from "lucide-react"
import { Monograma, NomeDaMarca } from "@/frontend/marca"

/* A moldura das telas de quem ainda não entrou (login, esqueci, redefinir).
   O painel da marca é sempre escuro, nos dois temas: é a "capa" do
   sistema, e o azul-aço lê melhor sobre marinho. No celular ele some e
   fica só o nome acima do formulário. */
export function TelaDeAcesso({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-svh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section
        aria-hidden
        className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between"
        style={{
          background:
            "radial-gradient(120% 90% at 0% 0%, oklch(0.42 0.1 262) 0%, transparent 55%), radial-gradient(90% 70% at 100% 100%, oklch(0.34 0.08 250) 0%, transparent 60%), oklch(0.2 0.04 262)",
        }}
      >
        {/* Grade fina ao fundo: o "quadro" de trabalho, sem desenho literal */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div className="relative flex items-center gap-3">
          <Monograma className="size-10 bg-white text-[oklch(0.25_0.05_262)]" />
          <NomeDaMarca className="text-lg" />
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl leading-tight font-semibold tracking-tight text-balance">
            A operação da Suplelive, num lugar só.
          </h1>
          <ul className="mt-8 grid gap-3 text-[15px] text-white/80">
            {["Tarefas de cada área num quadro que a equipe inteira vê", "Cada mudança registrada com quem fez e quando", "Nada some sem alguém mandar sumir"].map((t) => (
              <li key={t} className="flex gap-2.5"><CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-white/60" />{t}</li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/50">Suplelive · uso interno</p>
      </section>

      <section className="flex flex-col items-center justify-center gap-8 bg-background px-6 py-12">
        <div className="flex items-center gap-2.5 lg:hidden">
          <Monograma />
          <NomeDaMarca className="text-lg" />
        </div>
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </main>
  )
}
