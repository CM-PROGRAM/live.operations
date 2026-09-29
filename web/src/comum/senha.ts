import * as z from "zod"

/* As regras de senha, iguais na tela e no servidor. Oito caracteres é o
   mínimo que ainda se lembra de cabeça e já não se adivinha em minutos —
   o limite de tentativas por minuto no login faz o resto. */
export const NovaSenha = z
  .string()
  .min(8, { error: "A senha precisa ter pelo menos 8 caracteres" })
  .max(200, { error: "Senha longa demais" })

export const TrocaDeSenha = z
  .object({ atual: z.string().min(1, { error: "Informe a senha atual" }), nova: NovaSenha, confirmacao: z.string() })
  .refine((d) => d.nova === d.confirmacao, { error: "As duas senhas não são iguais", path: ["confirmacao"] })

export const PedidoDeRedefinicao = z.object({
  email: z.string().trim().min(3, { error: "Informe o seu e-mail" }).max(200),
})

export const Redefinicao = z
  .object({ token: z.string().min(20).max(200), nova: NovaSenha, confirmacao: z.string() })
  .refine((d) => d.nova === d.confirmacao, { error: "As duas senhas não são iguais", path: ["confirmacao"] })
