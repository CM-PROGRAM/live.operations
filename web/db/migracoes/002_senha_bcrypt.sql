-- ═══════════════════════════════════════════════════════════════════
-- 002 — SENHA EM BCRYPT, CALCULADA PELO POSTGRES
-- ═══════════════════════════════════════════════════════════════════
--
-- O hash passa a ser bcrypt feito pela pgcrypto (crypt + gen_salt('bf')).
-- O sal e o custo ficam dentro do próprio hash, então as colunas `sal` e
-- `iteracoes` saem. A conta pesada sai do servidor do site — que na
-- Cloudflare grátis tem 10 ms de processamento por pedido — e vai para o
-- banco.
--
-- As senhas no formato anterior não têm como ser convertidas (ninguém
-- sabe a senha original): são apagadas e definidas de novo com
-- `npm run db:usuarios -- <chave>`.

DELETE FROM senhas WHERE hash NOT LIKE '$2%';
ALTER TABLE senhas DROP COLUMN sal, DROP COLUMN iteracoes;
