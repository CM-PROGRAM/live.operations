# LiveOps — o sistema novo (Next.js + Neon)

É a versão do LiveOps que substitui, **um módulo por vez**, o `index.html`
da raiz. Os dois rodam juntos durante a migração: o que já foi migrado abre
aqui, e o resto continua no sistema atual, com link na barra lateral.

| Módulo | Situação |
|---|---|
| Login | ✅ migrado — as mesmas senhas do cofre do worker |
| Central de Tarefas | ✅ migrado |
| Todos os outros | no sistema atual (`index.html`) |

## Como está organizado

O backend e o frontend moram no mesmo projeto Next.js, mas em pastas que
não se misturam:

```
web/
├── db/migracoes/        o esquema, em SQL puro, aplicado em ordem
├── scripts/             migrar, criar usuários, importar do D1
├── testes/              node:test — rodam contra um Postgres de verdade
└── src/
    ├── backend/         SÓ servidor ("server-only"): banco, login, regras
    │   ├── auth/        senha (PBKDF2 igual ao worker), sessão, login
    │   └── tarefas/     o serviço de tarefas, com auditoria na transação
    ├── comum/           o contrato entre os dois lados (tipos + validação zod)
    ├── frontend/        SÓ tela: componentes React da aplicação
    ├── components/ui/   shadcn/ui — o sistema de design dos templates da Vercel
    └── app/             rotas do Next: páginas e a API em app/api/*
```

A regra: `frontend/` nunca importa de `backend/`. Ele fala com o servidor
pela API (`/api/...`) e usa `comum/` para validar os formulários com as mesmas
regras do servidor. Se alguém tentar importar o backend numa tela, o
`server-only` quebra o build — de propósito.

### A API

| Rota | O quê |
|---|---|
| `POST /api/auth/entrar` | `{usuario, senha}` → cookie de sessão (12h) |
| `POST /api/auth/sair` | encerra a sessão |
| `GET /api/tarefas?status=&responsavel=&busca=` | lista + contagem por status |
| `POST /api/tarefas` | cria |
| `GET/PATCH/DELETE /api/tarefas/:id` | detalhe, edição, exclusão (lógica) |
| `POST /api/tarefas/:id/comentarios` | comenta |

Toda rota confere sessão e permissão no servidor (`src/backend/http.ts`).

## O que mudou em relação ao sistema atual, e por quê

- **Não existe mais "pacote de estado" entre navegadores.** Cada mudança é
  uma chamada à API que grava uma linha no banco. Foi o pacote que causou os
  três apagões de 01/09 e a instabilidade de setembro (o cache do navegador
  sobrescrevendo a nuvem).
- **A auditoria é feita pelo servidor**, na mesma transação da mudança, e não
  mais por um diff de estado no navegador — que encheu o D1 de 741 mil
  "excluído" falsos.
- **Excluir é lógico** (`excluido_em`): some da tela, fica no banco, com
  quem excluiu e quando.
- **Sessão no banco**, com o cookie guardando só um segredo aleatório (o
  banco guarda o hash dele). Sair revoga de verdade.

## Publicar (Vercel + Neon)

1. **Neon** — criar um projeto (região `aws-sa-east-1`, São Paulo) e copiar a
   *connection string* com **pooling** (host com `-pooler`).
2. **Esquema e usuários**, do seu computador, dentro de `web/`:
   ```bash
   npm install
   export DATABASE_URL="postgres://...-pooler.../neondb?sslmode=require"
   npm run db:migrar
   npm run db:usuarios
   ```
3. **Trazer senhas e tarefas do D1** (só lê o D1, não altera nada lá; pode
   repetir quantas vezes quiser):
   ```bash
   export CF_ACCOUNT_ID="..."    # Cloudflare, barra lateral de qualquer página
   export CF_API_TOKEN="..."     # token com permissão D1 → Read
   npm run db:importar
   ```
4. **Vercel** — *Add New → Project* → este repositório → **Root Directory:
   `web`**. Em *Environment Variables*, `DATABASE_URL` com a mesma string
   do passo 1. *Deploy*.

O `index.html` da raiz continua sendo publicado pelo GitHub Pages como
sempre; nada nesta pasta muda o sistema atual.

## Desenvolver

```bash
cp .env.example .env.local     # e preencha DATABASE_URL
npm run dev                    # http://localhost:3000
npm test                       # precisa de TESTE_DATABASE_URL (um Postgres descartável)
npm run lint && npm run typecheck
```

Os testes que tocam banco são **pulados** sem `TESTE_DATABASE_URL` — nunca
aponte essa variável para o banco de produção: o teste de tarefas apaga as
tabelas antes de rodar.
