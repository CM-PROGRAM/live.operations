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

/* As sete áreas da Central de Tarefas, na ordem e com os nomes do sistema
   antigo (ATV_AREAS no index.html, hoje no histórico do Git). "vendas" aparece como Canceladas: é o
   id que o sistema atual grava, e mudar o id quebraria a importação. */
export const AREAS = ["diarias", "atendimentos", "vendas", "anuncios", "financeiro", "marketplaces", "devolucoes"] as const
export type Area = (typeof AREAS)[number]
export const INFO_AREA: Record<Area, { rotulo: string; descricao: string; permissao: string | null }> = {
  diarias: { rotulo: "Diárias", descricao: "O que você mesmo anotou para não esquecer.", permissao: null },
  atendimentos: { rotulo: "Atendimentos", descricao: "Retornos de atendimento no dia marcado.", permissao: "atendimentos" },
  vendas: { rotulo: "Canceladas", descricao: "Pedidos cancelados e o que veio das vendas.", permissao: null },
  anuncios: { rotulo: "Anúncios", descricao: "Entrada, integração, imagens, exclusão e catálogo.", permissao: "integracoes" },
  financeiro: { rotulo: "Financeiro", descricao: "Conferência das vendas do WhatsApp.", permissao: "whatsapp" },
  marketplaces: { rotulo: "Marketplaces", descricao: "A revisão diária de cada loja.", permissao: "plataformas" },
  devolucoes: { rotulo: "Devoluções", descricao: "Devoluções e canceladas com nota fiscal.", permissao: "devolucoes" },
}

/* As colunas do quadro. "atrasada" não é um status gravado: é a tarefa em
   aberto cujo prazo passou — por isso não dá para soltar um cartão nela. */
export const COLUNAS = ["aberta", "atrasada", "andamento", "concluida", "finalizada"] as const
export type Coluna = (typeof COLUNAS)[number]
export const ROTULO_COLUNA: Record<Coluna, string> = {
  aberta: "A Fazer",
  atrasada: "Atrasada",
  andamento: "Com Pendência",
  concluida: "Concluída",
  finalizada: "Finalizada",
}
export function colunaDa(t: { status: Status; atrasada: boolean }): Coluna {
  return t.atrasada ? "atrasada" : t.status
}

const dataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Data inválida" })

export const NovaTarefa = z.object({
  titulo: z.string().trim().min(1, { error: "Dê um título à tarefa" }).max(200),
  descricao: z.string().trim().max(5000).optional().default(""),
  prioridade: z.enum(PRIORIDADES).default("normal"),
  vencimento: dataISO.nullable().optional(),
  responsaveis: z.array(z.string()).min(1, { error: "Escolha ao menos um responsável" }),
  area: z.enum(AREAS).default("diarias"),
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
  area: z.enum(AREAS).optional(),
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
  area: Area
}

export type TarefaDetalhe = TarefaResumo & {
  comentariosLista: { id: number; texto: string; autor: string | null; criado_em: string }[]
  historico: { evento: string; campo: string | null; de: string | null; para: string | null; autor: string | null; em: string }[]
}
