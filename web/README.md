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
    │   ├── auth/        senha (bcrypt no Postgres), sessão, login, redefinição
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

## Publicar (Cloudflare Workers + Neon)

O site roda num Worker da Cloudflare (plano grátis), pelo adaptador
OpenNext; o banco é Postgres no Neon (plano grátis).

- **Banco:** projeto `liveops` no Neon (São Paulo). Migração nova:
  `DATABASE_URL=... npm run db:migrar`.
- **Worker:** *Workers & Pages → Create → Import a repository* → este
  repositório, com **Root directory** `web`, **Build command**
  `npx opennextjs-cloudflare build` e **Deploy command** `npx wrangler deploy`.
  Depois disso, todo push no `main` publica sozinho.
- **Segredos do Worker** (*Settings → Variables and Secrets*, tipo Secret):
  `DATABASE_URL` com a *connection string* **pooled** do Neon (host com
  `-pooler`), e `RESEND_API_KEY` para o e-mail de "Esqueci minha senha".
  Opcionais: `APP_URL` (endereço público usado no link do e-mail; sem ele
  vale o endereço do próprio pedido) e `EMAIL_REMETENTE` (precisa de
  domínio verificado no Resend).
- **Senha de alguém:** `DATABASE_URL=... npm run db:usuarios -- <chave>`
  (pede a senha no terminal).

**Limites do plano grátis que moldam o código:** 10 ms de processamento
por pedido — por isso o hash de senha (bcrypt) é feito pelo Postgres, não
pelo Worker — e uma conexão de banco não pode passar de um pedido para
outro, por isso `src/backend/db.ts` abre uma por consulta quando roda lá.
O Worker inteiro tem de caber em 3 MB comprimido (hoje: ~2,5 MB).

## Desenvolver

```bash
cp .env.example .env.local     # e preencha DATABASE_URL
npm run dev                    # http://localhost:3000
npm test                       # precisa de TESTE_DATABASE_URL (um Postgres descartável)
npm run lint && npm run typecheck
npm run cf:preview             # o build da Cloudflare rodando local (wrangler dev);
                               # variáveis em .dev.vars, como DATABASE_URL=...
```

Os testes que tocam banco são **pulados** sem `TESTE_DATABASE_URL` — nunca
aponte essa variável para o banco de produção: o teste de tarefas apaga as
tabelas antes de rodar.
