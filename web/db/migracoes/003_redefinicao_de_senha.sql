-- ═══════════════════════════════════════════════════════════════════
-- 003 — REDEFINIÇÃO DE SENHA ("Esqueci minha senha")
-- ═══════════════════════════════════════════════════════════════════
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
