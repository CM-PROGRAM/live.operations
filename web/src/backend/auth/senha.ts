import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

const pbkdf2Async = promisify(pbkdf2)

/* A MESMA conta do worker (cloudflare/worker-imagens/worker.js,
   _hashSenha): PBKDF2-SHA256, 32 bytes, sal e resultado em base64url.
   Precisa ser idêntica bit a bit — é o que deixa as senhas do cofre
   atual valerem aqui sem ninguém redefinir a sua. */
export const VOLTAS_PADRAO = 150_000

export async function calcularHash(senha: string, sal: string, voltas: number): Promise<string> {
  const bits = await pbkdf2Async(senha, Buffer.from(sal, "base64url"), voltas, 32, "sha256")
  return bits.toString("base64url")
}

export async function criarHash(senha: string) {
  const sal = randomBytes(16).toString("base64url")
  const hash = await calcularHash(senha, sal, VOLTAS_PADRAO)
  return { sal, hash, voltas: VOLTAS_PADRAO }
}

export async function conferirSenha(
  senha: string,
  guardado: { sal: string; hash: string; iteracoes: number }
): Promise<boolean> {
  const calculado = Buffer.from(await calcularHash(senha, guardado.sal, guardado.iteracoes))
  const esperado = Buffer.from(guardado.hash)
  // Mesmo tempo para qualquer entrada: comparar com === vazaria, pelo
  // relógio, quantos caracteres iniciais estavam certos.
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado)
}
