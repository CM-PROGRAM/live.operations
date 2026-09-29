import "server-only"

/* E-mail sai pelo Resend (resend.com), pela API HTTP — sem biblioteca.
   Sem RESEND_API_KEY configurada, nada é enviado e quem chamou fica
   sabendo (enviado: false) para decidir o que dizer. */
export async function enviarEmail(para: string, assunto: string, html: string, texto: string) {
  const chave = process.env.RESEND_API_KEY
  const de = process.env.EMAIL_REMETENTE || "Live Operations <onboarding@resend.dev>"
  if (!chave) {
    console.warn("[email] RESEND_API_KEY ausente — e-mail não enviado:", assunto)
    return { enviado: false as const, motivo: "sem-configuracao" }
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: de, to: [para], subject: assunto, html, text: texto }),
  })
  if (!r.ok) {
    console.error("[email] Resend recusou:", r.status, await r.text().catch(() => ""))
    return { enviado: false as const, motivo: "recusado" }
  }
  return { enviado: true as const }
}
