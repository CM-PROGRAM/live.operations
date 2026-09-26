"use client"

import { CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type Pessoa = { chave: string; nome: string; cor: string; iniciais: string }

/* Várias pessoas podem ser responsáveis; a primeira escolhida é a
   principal. Botões em vez de lista suspensa: são quatro pessoas, e ver
   todas de uma vez é mais rápido que abrir um menu. */
export function EscolherPessoas({ pessoas, valor, onChange }: { pessoas: Pessoa[]; valor: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Responsáveis">
      {pessoas.map((p) => {
        const marcado = valor.includes(p.chave)
        return (
          <button
            key={p.chave}
            type="button"
            aria-pressed={marcado}
            onClick={() => onChange(marcado ? valor.filter((k) => k !== p.chave) : [...valor, p.chave])}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
              marcado ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"
            )}
          >
            <span className="flex size-5 items-center justify-center rounded-full text-[9px] font-semibold text-white" style={{ background: p.cor }}>
              {marcado ? <CheckIcon className="size-3" /> : p.iniciais}
            </span>
            {p.nome}
          </button>
        )
      })}
    </div>
  )
}
