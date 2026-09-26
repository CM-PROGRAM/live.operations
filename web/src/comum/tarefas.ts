import * as z from "zod"

/* Compartilhado entre API e tela: é o contrato do que uma tarefa aceita.
   Não importa nada de servidor, então o frontend pode usar para validar
   o formulário antes de enviar. */

export const STATUS = ["aberta", "andamento", "concluida", "finalizada"] as const
export const PRIORIDADES = ["normal", "alta", "urgente"] as const
export const FILTROS_STATUS = ["todas", "aberta", "andamento", "atrasada", "concluida", "finalizada"] as const

export type Status = (typeof STATUS)[number]
export type Prioridade = (typeof PRIORIDADES)[number]
export type FiltroStatus = (typeof FILTROS_STATUS)[number]

export const ROTULO_STATUS: Record<FiltroStatus, string> = {
  todas: "Todas",
  aberta: "A Fazer",
  andamento: "Com Pendência",
  atrasada: "Atrasada",
  concluida: "Concluídas",
  finalizada: "Finalizadas",
}

export const ROTULO_PRIORIDADE: Record<Prioridade, string> = {
  normal: "Normal",
  alta: "Alta",
  urgente: "Urgente",
}

const dataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Data inválida" })

export const NovaTarefa = z.object({
  titulo: z.string().trim().min(1, { error: "Dê um título à tarefa" }).max(200),
  descricao: z.string().trim().max(5000).optional().default(""),
  prioridade: z.enum(PRIORIDADES).default("normal"),
  vencimento: dataISO.nullable().optional(),
  responsaveis: z.array(z.string()).min(1, { error: "Escolha ao menos um responsável" }),
})
export type NovaTarefa = z.infer<typeof NovaTarefa>

export const EdicaoTarefa = z
  .object({
    titulo: z.string().trim().min(1).max(200),
    descricao: z.string().trim().max(5000),
    prioridade: z.enum(PRIORIDADES),
    vencimento: dataISO.nullable(),
    status: z.enum(STATUS),
    pendencia: z.string().trim().max(2000).nullable(),
    responsaveis: z.array(z.string()).min(1),
  })
  .partial()
  // "Com Pendência" sem dizer qual é a pendência não ajuda ninguém
  .refine((e) => e.status !== "andamento" || (e.pendencia ?? "").length > 0, {
    error: "Descreva a pendência",
    path: ["pendencia"],
  })
export type EdicaoTarefa = z.infer<typeof EdicaoTarefa>

export const NovoComentario = z.object({
  texto: z.string().trim().min(1, { error: "Escreva o comentário" }).max(5000),
})

export const FiltroTarefas = z.object({
  status: z.enum(FILTROS_STATUS).default("todas"),
  responsavel: z.string().optional(), // chave do usuário
  busca: z.string().trim().max(100).optional(),
})
export type FiltroTarefas = z.infer<typeof FiltroTarefas>

export type TarefaResumo = {
  id: number
  titulo: string
  descricao: string | null
  prioridade: Prioridade
  status: Status
  pendencia: string | null
  vencimento: string | null
  atrasada: boolean
  responsaveis: { chave: string; nome: string; cor: string; iniciais: string }[]
  comentarios: number
  criado_em: string
  concluido_em: string | null
  concluido_por: string | null
  origem: string | null
}

export type TarefaDetalhe = TarefaResumo & {
  comentariosLista: { id: number; texto: string; autor: string | null; criado_em: string }[]
  historico: { evento: string; campo: string | null; de: string | null; para: string | null; autor: string | null; em: string }[]
}
