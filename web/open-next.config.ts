// Configuração do adaptador da Cloudflare. Sem cache incremental: todas as
// páginas leem o banco a cada pedido, então não há o que guardar.
import { defineCloudflareConfig } from "@opennextjs/cloudflare"

export default defineCloudflareConfig({})
