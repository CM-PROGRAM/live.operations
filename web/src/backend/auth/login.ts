import "server-only"
import { consultar } from "@/backend/db"
import { conferirSenha } from "@/backend/auth/senha"
import { criarSessao } from "@/backend/auth/sessao"

/* Teto de tentativas por conta e por IP, na memória da instância. Não é
   exato — cada instância tem a sua conta, como no worker — mas torna
   força bruta inviável, que é o objetivo. */
const TETO_POR_MINUTO = 8
const ritmo = new Map<string, { janela: number; n: number }>()
export function passouDoTeto(id: string) {
  const janela = Math.floor(Date.now() / 60_000)
  const r = ritmo.get(id)
  if (!r || r.janela !== janela) {
    if (ritmo.size > 5000) ritmo.clear()
    ritmo.set(id, { janela, n: 1 })
    return false
  }
  return ++r.n > TETO_POR_MINUTO
}

export type ResultadoLogin = { ok: true } | { ok: false; erro: string }

/* Entra por e-mail ou pela chave ('gustavo'). A mensagem de erro é uma
   só para "não existe" e "senha errada": dizer qual dos dois é entregar
   a lista de contas para quem tenta adivinhar. */
export async function entrar(identificador: string, senha: string, ip: string): Promise<ResultadoLogin> {
  const id = identificador.trim().toLowerCase()
  if (passouDoTeto("ip:" + ip) || passouDoTeto("conta:" + id)) {
    return { ok: false, erro: "Muitas tentativas. Espere um minuto e tente de novo." }
  }
  const [linha] = await consultar<{ id: number; sal: string; hash: string; iteracoes: number }>(
    `SELECT u.id::int AS id, s.sal, s.hash, s.iteracoes
       FROM usuarios u JOIN senhas s ON s.usuario_id = u.id
      WHERE u.ativo AND (u.email = $1 OR u.chave = $1)`,
    [id]
  )
  if (!linha || !(await conferirSenha(senha, linha))) {
    return { ok: false, erro: "E-mail ou senha incorretos." }
  }
  await criarSessao(linha.id)
  return { ok: true }
}
