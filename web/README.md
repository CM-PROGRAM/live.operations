# Live Operations — Next.js + Neon

O sistema de operações da Suplelive. Hoje é o esqueleto: o banco começa
vazio, só com o usuário master.

| Módulo | Situação |
|---|---|
| Login | ✅ pronto |
| Central de Tarefas (quadro Kanban por área) | ✅ pronto |
| Vendas, Canceladas, Devoluções, Atendimentos, Estoque, Compras, Anúncios, WhatsLive, Administrador | em breve — o esquema planejado está em `db/esquema-completo.sql` |

## Como está organizado

O backend e o frontend moram no mesmo projeto Next.js, mas em pastas que
não se misturam:

```
web/
├── db/migracoes/        o esquema, em SQL puro, aplicado em ordem
├── db/esquema-completo.sql  o banco inteiro planejado, módulo a módulo
├── scripts/             aplicar migrações, criar usuário e senha
├── testes/              node:test — rodam contra um Postgres de verdade
└── src/
    ├── backend/         SÓ servidor ("server-only"): banco, login, regras
    │   ├── auth/        senha (PBKDF2), sessão, login, redefinição
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
| `POST /api/auth/senha` | `{atual, nova, confirmacao}` — troca a própria senha (encerra as outras sessões) |
| `POST /api/auth/esqueci` | `{email}` → manda por e-mail um link de redefinição (1 hora, uso único) |
| `POST /api/auth/redefinir` | `{token, nova, confirmacao}` — cria a senha nova e encerra todas as sessões |
| `GET /api/tarefas?status=&responsavel=&busca=` | lista + contagem por status |
| `POST /api/tarefas` | cria |
| `GET/PATCH/DELETE /api/tarefas/:id` | detalhe, edição, exclusão (lógica) |
| `POST /api/tarefas/:id/comentarios` | comenta |

Toda rota confere sessão e permissão no servidor (`src/backend/http.ts`).

## Por que ele é feito assim

Para nada se perder nem ser sobrescrito:

- **Cada ação é uma chamada à API que grava uma linha no banco.** Não
  existe cópia do estado no navegador que possa sobrescrever a nuvem.
- **A auditoria é gravada pelo servidor**, na mesma transação da mudança.
- **Excluir é lógico** (`excluido_em`): some da tela, fica no banco, com
  quem excluiu e quando.
- **Sessão no banco**, com o cookie guardando só um segredo aleatório (o
  banco guarda o hash dele). Sair revoga de verdade.

## Publicar (Vercel + Neon)

- **Banco:** projeto `liveops` no Neon (São Paulo), plano grátis. As
  migrações de `db/migracoes/` já estão aplicadas.
- **Vercel:** *Add New → Project* → este repositório → **Root Directory:
  `web`** → variável `DATABASE_URL` com a *connection string* **pooled** do
  Neon (host com `-pooler`) → *Deploy*. Depois disso, todo push no `main`
  publica sozinho.
- **E-mail (link de "Esqueci minha senha"):** variáveis `RESEND_API_KEY`,
  `APP_URL` (o endereço público) e, com domínio verificado no Resend,
  `EMAIL_REMETENTE`. Sem elas o pedido é aceito mas o e-mail não sai.
- **Migração nova:** `DATABASE_URL=... npm run db:migrar`.
- **Senha de alguém:** `DATABASE_URL=... npm run db:usuarios -- <chave>`
  (pede a senha no terminal).

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
