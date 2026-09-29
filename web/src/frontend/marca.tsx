import { cn } from "@/lib/utils"

/* A marca é texto, não imagem: "Live Operations" escrito na fonte do
   sistema, e o monograma LO para onde só cabe um quadrado (barra lateral
   recolhida, aba do navegador). As imagens antigas traziam o pássaro e o
   nome LIVEOPS, que saíram. */

export function Monograma({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-[13px] font-bold tracking-tight text-primary-foreground",
        className
      )}
    >
      LO
    </span>
  )
}

export function NomeDaMarca({ className }: { className?: string }) {
  return (
    <span className={cn("tracking-tight", className)}>
      <span className="font-semibold">Live</span> <span className="font-light">Operations</span>
    </span>
  )
}
