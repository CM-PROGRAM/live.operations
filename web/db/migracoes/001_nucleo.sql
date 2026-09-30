-- ═══════════════════════════════════════════════════════════════════
-- 001 — O NÚCLEO: identidade, permissões, sessões e tarefas
-- ═══════════════════════════════════════════════════════════════════
--
-- Recorte de db/esquema-completo.sql com o que o primeiro módulo
-- (Login + Central de Tarefas) precisa.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ═══ IDENTIDADE ════════════════════════════════════════════════════

CREATE TABLE usuarios (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chave          text        NOT NULL UNIQUE,   -- 'ana', 'bruno'
  nome           text        NOT NULL,
  email          citext      NOT NULL UNIQUE,   -- é por ele que se entra
  master         boolean     NOT NULL DEFAULT false,
  cor            text        NOT NULL DEFAULT '#888888',
  iniciais       text        NOT NULL,
  ativo          boolean     NOT NULL DEFAULT true,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

-- PBKDF2-SHA256, sal por pessoa, voltas gravadas por linha (dá para
-- subir as voltas depois sem invalidar as senhas antigas).
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

-- O cookie leva um segredo aleatório e o banco guarda só o
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
  -- O motivo do "Com Pendência" é texto que a tela mostra.
  pendencia      text,
  concluido_em   timestamptz,
  concluido_por  bigint      REFERENCES usuarios(id),
  origem         text,       -- 'manual' | 'rotina' | 'integracao' | 'cancelada' | ...
  origem_ref     text,
  criado_por     bigint      REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz,         -- some da tela, fica no banco
  -- diarias · atendimentos · vendas (a tela chama de "Canceladas") ·
  -- anuncios · financeiro · marketplaces · devolucoes
  area           text        NOT NULL DEFAULT 'diarias'
                 CHECK (area IN ('diarias','atendimentos','vendas','anuncios','financeiro','marketplaces','devolucoes'))
);
CREATE INDEX ON tarefas (responsavel_id, status) WHERE excluido_em IS NULL;
CREATE INDEX ON tarefas (vencimento) WHERE excluido_em IS NULL AND status <> 'concluida';
CREATE INDEX ON tarefas (criado_em DESC) WHERE excluido_em IS NULL;
CREATE INDEX ON tarefas (area, status) WHERE excluido_em IS NULL;

-- Uma tarefa pode ter mais de um responsável; `responsavel_id` é o
-- principal.
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

-- A auditoria campo a campo, `evento` = 'criado' | 'editado' |
-- 'excluido'. Gravada pelo SERVIDOR, na mesma transação da mudança —
-- nunca por um diff feito no navegador.
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

-- ═══ REDEFINIÇÃO DE SENHA ("Esqueci minha senha") ═════════════════
--
-- Cada pedido é uma linha: o link enviado por e-mail leva um segredo
-- aleatório e o banco guarda só o SHA-256 dele, como nas sessões. Quem
-- lesse esta tabela não conseguiria usar nenhum link.
--
-- O link vale 1 hora e uma vez só (`usado_em`). Usar um link invalida os
-- outros pedidos abertos da mesma pessoa e encerra as sessões dela: quem
-- redefine a senha porque desconfia de alguém quer esse alguém fora.

CREATE TABLE redefinicoes_senha (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash     text        NOT NULL UNIQUE,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  expira_em      timestamptz NOT NULL,
  usado_em       timestamptz,
  ip             inet
);
CREATE INDEX ON redefinicoes_senha (usuario_id) WHERE usado_em IS NULL;
