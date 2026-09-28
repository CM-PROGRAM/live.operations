import { test } from "node:test"
import assert from "node:assert/strict"
import { calcularHash, conferirSenha, criarHash } from "../src/backend/auth/senha"

/* Cópia fiel de _hashSenha e dos conversores base64url do worker
   antigo (cloudflare/worker-imagens/worker.js, hoje só no histórico do
   Git). A senha do master veio de lá: se o cálculo daqui mudar, ela para
   de valer — este teste é o alarme. */
function b64urlBytes(s: string) {
  s = s.replace(/-/g, "+").replace(/_/g, "/")
  while (s.length % 4) s += "="
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function b64urlDeBytes(buf: ArrayBuffer) {
  let s = ""
  const b = new Uint8Array(buf)
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
async function hashDoWorker(senha: string, sal: string, voltas: number) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(senha)), { name: "PBKDF2" }, false, ["deriveBits"])
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: b64urlBytes(sal), iterations: voltas, hash: "SHA-256" }, base, 256)
  return b64urlDeBytes(bits)
}

test("o hash é idêntico ao do worker, inclusive com acento", async () => {
  const sal = b64urlDeBytes(crypto.getRandomValues(new Uint8Array(16)).buffer)
  for (const senha of ["abc123", "Suplelive@2026", "ação-çé"]) {
    for (const voltas of [8000, 150000]) {
      assert.equal(await calcularHash(senha, sal, voltas), await hashDoWorker(senha, sal, voltas))
    }
  }
})

test("senha gravada pelo worker é aceita aqui; senha errada não", async () => {
  const sal = b64urlDeBytes(crypto.getRandomValues(new Uint8Array(16)).buffer)
  const guardado = { sal, hash: await hashDoWorker("minhaSenha", sal, 60000), iteracoes: 60000 }
  assert.equal(await conferirSenha("minhaSenha", guardado), true)
  assert.equal(await conferirSenha("minhasenha", guardado), false)
  assert.equal(await conferirSenha("", guardado), false)
})

test("criarHash usa sal novo a cada vez", async () => {
  const a = await criarHash("x"), b = await criarHash("x")
  assert.notEqual(a.sal, b.sal)
  assert.equal(await conferirSenha("x", { ...a, iteracoes: a.voltas }), true)
})
