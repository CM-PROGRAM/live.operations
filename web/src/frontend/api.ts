/* Uma porta só para o frontend falar com o backend. Erro vira exceção
   com a mensagem que o servidor mandou — que é a que vai para a tela. */
export async function chamarApi<T = unknown>(url: string, metodo = "GET", corpo?: unknown): Promise<T> {
  let r: Response
  try {
    r = await fetch(url, {
      method: metodo,
      headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    })
  } catch {
    throw new Error("Sem conexão com o servidor. Nada foi gravado — tente de novo.")
  }
  const j = await r.json().catch(() => ({}))
  if (r.status === 401) {
    window.location.assign(new URL("/entrar", window.location.origin))
    throw new Error(j.erro || "Sessão expirada")
  }
  if (!r.ok) throw new Error(j.erro || `Falha (${r.status})`)
  return j as T
}
