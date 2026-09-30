import "server-only"
import { Pool, type PoolClient, type QueryResultRow } from "pg"

/* Uma conexão por processo. Na Vercel cada instância é um processo, e
   a URL "pooled" do Neon (com -pooler no host) faz o resto: é ela que
   aguenta muitas instâncias abrindo conexão ao mesmo tempo. */
const globalParaPool = globalThis as unknown as { _liveopsPool?: Pool }

function pool(): Pool {
  if (!globalParaPool._liveopsPool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error("DATABASE_URL não configurada")
    globalParaPool._liveopsPool = new Pool({ connectionString: url, max: 5 })
  }
  return globalParaPool._liveopsPool
}

export async function consultar<T extends QueryResultRow>(
  texto: string,
  valores: unknown[] = []
): Promise<T[]> {
  const r = await pool().query<T>(texto, valores)
  return r.rows
}

/* Mudança e auditoria entram juntas ou não entram. Sem isto, uma falha
   no meio deixaria a tarefa alterada sem registro de quem alterou — ou
   o registro de uma alteração que não aconteceu. */
export async function emTransacao<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect()
  try {
    await c.query("BEGIN")
    const r = await fn(c)
    await c.query("COMMIT")
    return r
  } catch (e) {
    await c.query("ROLLBACK")
    throw e
  } finally {
    c.release()
  }
}

// Para scripts e testes: sem isto o processo fica esperando o pool.
export async function encerrarConexoes() {
  await globalParaPool._liveopsPool?.end()
  globalParaPool._liveopsPool = undefined
}
