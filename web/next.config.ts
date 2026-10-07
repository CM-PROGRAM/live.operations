import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // O `pg` na Cloudflare usa o pacote pg-cloudflare, que o rastreio de
  // arquivos do Next não vê (ele só é carregado no runtime workerd).
  outputFileTracingIncludes: { "/*": ["./node_modules/pg-cloudflare/**/*"] },
}

export default nextConfig

// Deixa `next dev` enxergar os recursos da Cloudflare (variáveis, bindings)
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare"
initOpenNextCloudflareForDev()
