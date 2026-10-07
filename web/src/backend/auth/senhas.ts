import "server-only"
import { createHash, randomBytes } from "node:crypto"
import { consultar, emTransacao } from "@/backend/db"
import { enviarEmail } from "@/backend/email"
import { conferirSenha, definirSenha } from "@/backend/auth/senha"
import type { Usuario } from "@/backend/auth/sessao"

const hash = (t: string) => createHash("sha256").update(t).digest("hex")
const VALIDADE_MINUTOS = 60

export class ErroDeSenha extends Error {}

/* Trocar a própria senha, logado. Pede a atual: uma sessão esquecida
   aberta num computador não basta para tomar a conta de alguém. As outras
   sessões da pessoa são encerradas; a desta tela continua. */
export async function trocarSenha(u: Usuario, atual: string, nova: string, tokenSessaoAtual: string | undefined) {
  if (!(await conferirSenha(u.id, atual))) throw new ErroDeSenha("A senha atual não confere.")
  if (atual === nova) throw new ErroDeSenha("A nova senha precisa ser diferente da atual.")
  await emTransacao(async (c) => {
    await definirSenha(c, u.id, nova, u.id)
    await c.query(
      "UPDATE sessoes SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL AND token_hash <> $2",
      [u.id, tokenSessaoAtual ? hash(tokenSessaoAtual) : ""]
    )
  })
}

/* "Esqueci minha senha". A resposta para a tela é sempre a mesma, exista
   o e-mail ou não — dizer "esse e-mail não existe" entregaria a lista de
   contas a quem tenta adivinhar. O que muda fica no log do servidor. */
export async function pedirRedefinicao(email: string, urlBase: string, ip: string | null) {
  const [u] = await consultar<{ id: number; nome: string; email: string }>(
    "SELECT id::int AS id, nome, email::text AS email FROM usuarios WHERE ativo AND email = $1", [email.trim().toLowerCase()]
  )
  if (!u) { console.info("[senha] pedido de redefinição para e-mail sem conta"); return }

  // Um pedido novo não é aceito antes de 2 minutos do anterior: impede que
  // alguém encha a caixa de entrada da pessoa clicando sem parar.
  const [recente] = await consultar(
    "SELECT 1 FROM redefinicoes_senha WHERE usuario_id = $1 AND criado_em > now() - interval '2 minutes'", [u.id]
  )
  if (recente) { console.info("[senha] pedido repetido em menos de 2 minutos — ignorado"); return }

  const token = randomBytes(32).toString("base64url")
  await consultar(
    `INSERT INTO redefinicoes_senha (usuario_id, token_hash, expira_em, ip)
     VALUES ($1, $2, now() + interval '${VALIDADE_MINUTOS} minutes', $3::inet)`,
    [u.id, hash(token), ip]
  )
  const link = `${urlBase}/redefinir?token=${token}`
  const r = await enviarEmail(
    u.email,
    "Redefinir sua senha · Live Operations",
    `<div style="font-family:system-ui,sans-serif;max-width:480px;color:#1e293b">
      <h2 style="margin:0 0 12px">Redefinir sua senha</h2>
      <p>Olá, ${u.nome.replace(/</g, "&lt;")}. Recebemos um pedido para redefinir a senha do Live Operations.</p>
      <p><a href="${link}" style="display:inline-block;background:#3d5a94;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Criar nova senha</a></p>
      <p style="color:#64748b;font-size:13px">O link vale por 1 hora e funciona uma vez só. Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>
    </div>`,
    `Olá, ${u.nome}. Para criar uma nova senha do Live Operations, abra: ${link}\n\nO link vale por 1 hora e funciona uma vez só. Se não foi você, ignore este e-mail.`
  )
  if (!r.enviado) console.error("[senha] link de redefinição criado mas o e-mail não saiu:", r.motivo)
}

export async function redefinirComToken(token: string, nova: string) {
  await emTransacao(async (c) => {
    const r = await c.query<{ id: string; usuario_id: number }>(
      `SELECT id, usuario_id::int AS usuario_id FROM redefinicoes_senha
        WHERE token_hash = $1 AND usado_em IS NULL AND expira_em > now() FOR UPDATE`,
      [hash(token)]
    )
    const pedido = r.rows[0]
    if (!pedido) throw new ErroDeSenha("Este link expirou ou já foi usado. Peça um novo em \"Esqueci minha senha\".")
    await definirSenha(c, pedido.usuario_id, nova, null)
    // O link morre, os outros pedidos abertos também, e todas as sessões saem
    await c.query("UPDATE redefinicoes_senha SET usado_em = now() WHERE usuario_id = $1 AND usado_em IS NULL", [pedido.usuario_id])
    await c.query("UPDATE sessoes SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL", [pedido.usuario_id])
  })
}
