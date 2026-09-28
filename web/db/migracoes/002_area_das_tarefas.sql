-- ═══════════════════════════════════════════════════════════════════
-- 002 — A ÁREA DE CADA TAREFA
-- ═══════════════════════════════════════════════════════════════════
--
-- A Central de Tarefas do sistema atual separa o trabalho em sete áreas
-- (Diárias, Atendimentos, Canceladas, Anúncios, Financeiro, Marketplaces,
-- Devoluções), e a equipe navega por elas. Lá a área é deduzida da origem
-- a cada desenho da tela (_atvArea no index.html); aqui ela vira coluna,
-- decidida uma vez, na importação ou na criação.
--
-- A regra é a mesma, na mesma ordem: a marca explícita (areaTarefa)
-- primeiro, depois a origem, e por último o título das famílias que só
-- nascem em Anúncios.

ALTER TABLE tarefas ADD COLUMN area text NOT NULL DEFAULT 'diarias'
  CHECK (area IN ('diarias','atendimentos','vendas','anuncios','financeiro','marketplaces','devolucoes'));

UPDATE tarefas SET area = CASE
  WHEN legado->>'areaTarefa' IN ('diarias','atendimentos','vendas','anuncios','financeiro','marketplaces','devolucoes')
                                  THEN legado->>'areaTarefa'
  WHEN origem = 'atendimento'     THEN 'atendimentos'
  WHEN origem = 'rotina'          THEN 'marketplaces'
  WHEN origem = 'venda'           THEN 'financeiro'
  WHEN origem = 'canceladaNF'     THEN 'devolucoes'
  WHEN origem = 'cancelada'       THEN 'vendas'
  WHEN origem IN ('integracao','exclusaoInt','imagem','atuCatalogo','entrada') THEN 'anuncios'
  WHEN btrim(titulo) IN ('Integração','Exclusão Integração','Imagem','Entrada Produto',
                         'Atualização Catálogo','Atualização de Catálogo') THEN 'anuncios'
  ELSE 'diarias'
END;

CREATE INDEX ON tarefas (area, status) WHERE excluido_em IS NULL;
