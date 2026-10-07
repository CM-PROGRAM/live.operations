import "server-only"
import { Client, Pool, type ClientBase, type QueryResultRow } from "pg"

/* Na Cloudflare, uma conexão aberta num pedido não pode ser usada por
   outro (o runtime recusa), então cada consulta abre a sua e fecha no
   fim; a URL "pooled" do Neon (com -pooler no host) torna isso barato.
   Fora dela — scripts, testes, `next dev` — um pool por processo. */
const naCloudflare = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers"

const globalParaPool = globalThis as unknown as { _liveopsPool?: Pool }

function url(): string {
  const u = process.env.DATABASE_URL
  if (!u) throw new Error("DATABASE_URL não configurada")
  return u
}

function pool(): Pool {
  globalParaPool._liveopsPool ??= new Pool({ connectionString: url(), max: 5 })
  return globalParaPool._liveopsPool
}

// Uma conexão só para `fn`, devolvida (ou fechada) no fim, dê certo ou não
async function comConexao<T>(fn: (c: ClientBase) => Promise<T>): Promise<T> {
  if (naCloudflare) {
    const c = new Client({ connectionString: url() })
    await c.connect()
    try {
      return await fn(c)
    } finally {
      await c.end()
    }
  }
  const c = await pool().connect()
  try {
    return await fn(c)
  } finally {
    c.release()
  }
}

export async function consultar<T extends QueryResultRow>(
  texto: string,
  valores: unknown[] = []
): Promise<T[]> {
  if (!naCloudflare) return (await pool().query<T>(texto, valores)).rows
  return comConexao(async (c) => (await c.query<T>(texto, valores)).rows)
}

/* Mudança e auditoria entram juntas ou não entram. Sem isto, uma falha
   no meio deixaria a tarefa alterada sem registro de quem alterou — ou
   o registro de uma alteração que não aconteceu. */
export async function emTransacao<T>(fn: (c: ClientBase) => Promise<T>): Promise<T> {
  return comConexao(async (c) => {
    await c.query("BEGIN")
    try {
      const r = await fn(c)
      await c.query("COMMIT")
      return r
    } catch (e) {
      await c.query("ROLLBACK")
      throw e
    }
  })
}

// Para scripts e testes: sem isto o processo fica esperando o pool.
export async function encerrarConexoes() {
  await globalParaPool._liveopsPool?.end()
  globalParaPool._liveopsPool = undefined
}
