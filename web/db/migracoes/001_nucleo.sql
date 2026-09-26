-- ═══════════════════════════════════════════════════════════════════
-- 001 — O NÚCLEO: identidade, permissões, sessões e tarefas
-- ═══════════════════════════════════════════════════════════════════
--
-- Recorte de docs/banco/schema.sql com o que o primeiro módulo do
-- sistema novo (Login + Central de Tarefas) precisa. As diferenças em
-- relação ao documento estão marcadas com "DIFERE:" e o porquê.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ═══ IDENTIDADE ════════════════════════════════════════════════════

CREATE TABLE usuarios (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chave          text        NOT NULL UNIQUE,   -- 'cmandrade', 'gustavo'
  nome           text        NOT NULL,
  email          citext      NOT NULL UNIQUE,   -- é por ele que se entra
  master         boolean     NOT NULL DEFAULT false,
  cor            text        NOT NULL DEFAULT '#888888',
  iniciais       text        NOT NULL,
  ativo          boolean     NOT NULL DEFAULT true,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

-- O mesmo cofre do worker (PBKDF2-SHA256, sal por pessoa, voltas
-- gravadas por linha). Sal e hash em base64url, como lá — é o que
-- permite trazer as senhas sem ninguém precisar redefinir a sua.
CREATE TABLE senhas (
  usuario_id     bigint      PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  sal            text        NOT NULL,
  hash           text        NOT NULL,
  iteracoes      integer     NOT NULL,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por bigint      REFERENCES usuarios(id)
);

-- Conceder é INSERT, revogar é concedida = false. Ausência não é
-- revogação: nenhuma cópia apaga permissão por omissão.
CREATE TABLE permissoes (
  usuario_id     bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  permissao      text        NOT NULL,
  concedida      boolean     NOT NULL,
  em             timestamptz NOT NULL DEFAULT now(),
  por_usuario_id bigint      REFERENCES usuarios(id),
  PRIMARY KEY (usuario_id, permissao)
);

CREATE TABLE permissoes_historico (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id     bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  permissao      text        NOT NULL,
  concedida      boolean     NOT NULL,
  em             timestamptz NOT NULL DEFAULT now(),
  por_usuario_id bigint      REFERENCES usuarios(id)
);
CREATE INDEX ON permissoes_historico (usuario_id, em DESC);

-- DIFERE: o cookie leva um segredo aleatório e o banco guarda só o
-- SHA-256 dele (`token_hash`). Com o id puro no banco, quem lesse a
-- tabela entraria como qualquer pessoa com sessão aberta.
CREATE TABLE sessoes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash     text        NOT NULL UNIQUE,
  usuario_id     bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criada_em      timestamptz NOT NULL DEFAULT now(),
  expira_em      timestamptz NOT NULL,
  revogada_em    timestamptz,
  ip             inet,
  agente         text
);
CREATE INDEX ON sessoes (usuario_id) WHERE revogada_em IS NULL;

-- ═══ TAREFAS ═══════════════════════════════════════════════════════

CREATE TABLE tarefas (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo         text        NOT NULL,
  descricao      text,
  prioridade     text        NOT NULL DEFAULT 'normal'
                 CHECK (prioridade IN ('normal','alta','urgente')),
  vencimento     date,
  prazo_horas    integer,
  responsavel_id bigint      REFERENCES usuarios(id),
  -- aberta = "A Fazer" · andamento = "Com Pendência" · concluida · finalizada
  status         text        NOT NULL DEFAULT 'aberta'
                 CHECK (status IN ('aberta','andamento','concluida','finalizada')),
  -- DIFERE: o motivo do "Com Pendência" é texto que a tela mostra.
  pendencia      text,
  concluido_em   timestamptz,
  concluido_por  bigint      REFERENCES usuarios(id),
  origem         text,       -- 'manual' | 'rotina' | 'integracao' | 'cancelada' | ...
  origem_ref     text,
  -- DIFERE: o id do sistema antigo (atv_...). É a chave da importação:
  -- rodá-la duas vezes atualiza, não duplica.
  legado_id      text        UNIQUE,
  -- DIFERE: os campos do sistema antigo que ainda não têm coluna
  -- (dados da loja, SKU, estorno, venda...). Guardados inteiros para
  -- que nada se perca na troca; cada módulo novo os promove a coluna.
  legado         jsonb       NOT NULL DEFAULT '{}',
  criado_por     bigint      REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz          -- some da tela, fica no banco
);
CREATE INDEX ON tarefas (responsavel_id, status) WHERE excluido_em IS NULL;
CREATE INDEX ON tarefas (vencimento) WHERE excluido_em IS NULL AND status <> 'concluida';
CREATE INDEX ON tarefas (criado_em DESC) WHERE excluido_em IS NULL;

-- DIFERE: o sistema antigo já tem tarefa com mais de um responsável
-- (1.600 das 1.710). `responsavel_id` continua sendo o principal.
CREATE TABLE tarefa_responsaveis (
  tarefa_id      bigint      NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  usuario_id     bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  PRIMARY KEY (tarefa_id, usuario_id)
);
CREATE INDEX ON tarefa_responsaveis (usuario_id);

-- Comentário é linha, não campo: dois textos escritos ao mesmo tempo
-- coexistem sem ninguém programar fusão.
CREATE TABLE comentarios (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entidade       text        NOT NULL,          -- 'tarefa' | 'devolucao' | ...
  entidade_id    bigint      NOT NULL,
  texto          text        NOT NULL,
  autor_id       bigint      REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz
);
CREATE INDEX ON comentarios (entidade, entidade_id, criado_em);

-- ═══ RASTRO ════════════════════════════════════════════════════════

-- A auditoria campo a campo. DIFERE: `evento` ('criado' | 'editado' |
-- 'excluido') — e ela é gravada pelo SERVIDOR, na mesma transação da
-- mudança. Nunca mais um diff de estado feito no navegador, que foi o
-- que encheu o D1 de 741 mil "excluido" falsos.
CREATE TABLE auditoria (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entidade       text        NOT NULL,
  entidade_id    bigint      NOT NULL,
  evento         text        NOT NULL,
  campo          text,
  de             text,
  para           text,
  usuario_id     bigint      REFERENCES usuarios(id),
  em             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON auditoria (entidade, entidade_id, em DESC);
