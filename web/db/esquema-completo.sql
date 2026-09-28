-- ═══════════════════════════════════════════════════════════════════
-- LIVEOPS — ESQUEMA DO BANCO (PostgreSQL / Neon)
-- ═══════════════════════════════════════════════════════════════════
--
-- Escrito em 02/09/2026, a partir das 25 coleções que o sistema já tem.
-- Nenhum campo foi inventado: cada coluna existe hoje, em algum registro
-- do LiveOps. O que mudou foi a FORMA — de blob JSON para linha.
--
-- ─── O QUE ESTE ESQUEMA RESOLVE DE GRAÇA ───────────────────────────
--
-- Três apagões, em 01/09/2026, com a mesma causa: não havia banco. O
-- estado viajava como um pacote JSON entre navegadores, e o último a
-- gravar vencia. Para cada um eu tive que inventar à mão um mecanismo
-- de consistência. Aqui eles são estrutura, não código:
--
--   1. PERMISSÕES QUE VOLTAVAM SOZINHAS
--      Virou a tabela `permissoes`, uma linha por (usuário, permissão).
--      Conceder é INSERT, revogar é UPDATE. Uma cópia velha não tem como
--      "não trazer" uma linha — ausência deixa de ser uma mensagem.
--
--   2. TAREFAS CONCLUÍDAS QUE VOLTAVAM PARA "A FAZER"
--      Virou `rotina_execucoes`: a conclusão é uma LINHA com autor e
--      hora, não um booleano dentro de um blob. Desfazer exige DELETE.
--
--   3. DEVOLUÇÕES QUE SUMIRAM SEM NINGUÉM CLICAR EM EXCLUIR
--      Toda tabela de trabalho tem `excluido_em`. Nada é apagado de
--      verdade; some da tela e continua no banco. "Sumiu" passa a ser
--      uma pergunta com resposta.
--
-- ─── CONVENÇÕES ────────────────────────────────────────────────────
--
--   · nomes em português, minúsculo, sem acento — igual ao resto do
--     sistema, para não haver tradução mental entre tela e banco;
--   · toda tabela: `id` bigint gerado, `criado_em`, `atualizado_em`;
--   · tabela de trabalho: `excluido_em timestamptz` (exclusão lógica);
--   · dinheiro em `numeric(12,2)` — nunca float, que erra centavo;
--   · datas com fuso: `timestamptz`, gravado em UTC, exibido em -03;
--   · o que a Base (BaseLinker) manda é espelho: `origem` diz de onde
--     veio e `congelado` marca o que a API não alcança mais.
--
-- ═══════════════════════════════════════════════════════════════════


-- ═══ 1. IDENTIDADE ═════════════════════════════════════════════════

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

-- O cofre de senhas. Já existe assim no worker (PBKDF2 com sal por
-- usuário) e é a única parte da autenticação de hoje que não precisa
-- mudar. O `passHash` SHA-256 que viajava no pacote MORRE aqui: era
-- um campo gravável que concedia login, e foi a brecha da v20.
CREATE TABLE senhas (
  usuario_id     bigint      PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  sal            text        NOT NULL,
  hash           text        NOT NULL,
  iteracoes      integer     NOT NULL,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por bigint      REFERENCES usuarios(id)
);

-- ─── O LIVRO DAS PERMISSÕES, agora como tabela ────────────────────
-- Em 01/09 isto virou um livro-razão dentro do JSON, porque com uma
-- LISTA de textos "cópia velha" e "revogada" eram indistinguíveis.
-- Como tabela o problema deixa de existir: conceder é uma linha,
-- revogar é `concedida = false`, e nenhuma cópia apaga por omissão.
CREATE TABLE permissoes (
  usuario_id     bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  permissao      text        NOT NULL,          -- 'compras', 'devolucoes', 'admin'
  concedida      boolean     NOT NULL,
  em             timestamptz NOT NULL DEFAULT now(),
  por_usuario_id bigint      REFERENCES usuarios(id),
  PRIMARY KEY (usuario_id, permissao)
);

-- O histórico de quem mexeu em permissão, que hoje não existe em
-- lugar nenhum — e fez falta nos três dias em que elas "resetavam".
CREATE TABLE permissoes_historico (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id     bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  permissao      text        NOT NULL,
  concedida      boolean     NOT NULL,
  em             timestamptz NOT NULL DEFAULT now(),
  por_usuario_id bigint      REFERENCES usuarios(id)
);
CREATE INDEX ON permissoes_historico (usuario_id, em DESC);

CREATE TABLE sessoes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criada_em      timestamptz NOT NULL DEFAULT now(),
  expira_em      timestamptz NOT NULL,
  revogada_em    timestamptz,
  ip             inet,
  agente         text
);
CREATE INDEX ON sessoes (usuario_id) WHERE revogada_em IS NULL;


-- ═══ 2. CLIENTES E PEDIDOS ═════════════════════════════════════════

-- Hoje são DUAS listas: `leads` (digitado na tela de Clientes) e o
-- cliente derivado do pedido. Misturar as duas apagava o que foi
-- digitado à mão — por isso ficaram separadas. Aqui é uma tabela só,
-- com `origem` dizendo de onde veio, e a fusão deixa de ser um risco.
CREATE TABLE clientes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome           text        NOT NULL DEFAULT '',
  cpf            text,                          -- só dígitos
  telefone       text,                          -- só dígitos, com DDI
  email          citext,
  origem         text        NOT NULL DEFAULT 'pedido',  -- 'pedido' | 'lead' | 'inbox'
  etapa          text,                          -- funil do lead: 'novo', ...
  obs            text,
  criado_por     bigint      REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz
);
CREATE UNIQUE INDEX ON clientes (cpf)      WHERE cpf IS NOT NULL AND excluido_em IS NULL;
CREATE UNIQUE INDEX ON clientes (telefone) WHERE telefone IS NOT NULL AND excluido_em IS NULL;

CREATE TABLE canais (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome           text        NOT NULL UNIQUE,   -- 'Shopee - Suple', 'ML - Vitalife1'
  base_source_id text,                          -- id da origem na BaseLinker
  ativo          boolean     NOT NULL DEFAULT true
);

CREATE TABLE pedidos (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero         text        NOT NULL UNIQUE,   -- o número na Base
  externo        text,                          -- o número na loja
  canal_id       bigint      REFERENCES canais(id),
  cliente_id     bigint      REFERENCES clientes(id),
  valor          numeric(12,2) NOT NULL DEFAULT 0,
  frete          numeric(12,2) NOT NULL DEFAULT 0,
  itens          integer     NOT NULL DEFAULT 0,
  status         text        NOT NULL DEFAULT '',
  feito_em       timestamptz,                   -- data + hora do pedido
  link           text,
  /* De onde veio e se ainda é lido. O pedido que a Base arquivou (3
     meses) não volta pela API: entra pelo CSV e fica congelado. Sem
     esta marca, a sincronização o trataria como sumido. */
  origem         text        NOT NULL DEFAULT 'api',  -- 'api' | 'csv-arquivo' | 'manual'
  congelado      boolean     NOT NULL DEFAULT false,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz
);
CREATE INDEX ON pedidos (feito_em DESC);
CREATE INDEX ON pedidos (cliente_id);
CREATE INDEX ON pedidos (canal_id, feito_em DESC);
CREATE INDEX ON pedidos (status);

-- Hoje o sistema guarda só a CONTAGEM de itens do pedido. A tabela
-- existe desde já porque a Base manda os itens e a Compras precisa
-- deles para casar produto vendido com produto comprado.
CREATE TABLE pedido_itens (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pedido_id      bigint      NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  sku            text,
  nome           text        NOT NULL DEFAULT '',
  quantidade     integer     NOT NULL DEFAULT 1,
  preco_unit     numeric(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX ON pedido_itens (pedido_id);
CREATE INDEX ON pedido_itens (sku);


-- ═══ 3. PÓS-VENDA ══════════════════════════════════════════════════

CREATE TABLE devolucoes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canal_id       bigint      REFERENCES canais(id),
  cliente_nome   text        NOT NULL DEFAULT '',
  pedido_numero  text,
  data           date,
  motivo         text,
  status         text,
  workflow       text        NOT NULL DEFAULT 'aberta',  -- 'pronto_estorno', 'concluida'
  responsavel_id bigint      REFERENCES usuarios(id),
  link_base      text,
  link_canal     text,
  pronto_em      timestamptz,
  concluido_em   timestamptz,
  criado_por     bigint      REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz          -- some da tela, fica no banco
);
CREATE INDEX ON devolucoes (workflow) WHERE excluido_em IS NULL;
CREATE INDEX ON devolucoes (data DESC);

CREATE TABLE atendimentos (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canal_id       bigint      REFERENCES canais(id),
  cliente_nome   text        NOT NULL DEFAULT '',
  numero         text,                          -- nº do atendimento na plataforma
  link_pedido    text,
  link           text,
  prazo          date,                          -- "Data Retorno"
  rastreio_codigo text,
  rastreio_link  text,
  data           date,
  motivo         text,
  workflow       text        NOT NULL DEFAULT 'aberto',
  alerta_enviado boolean     NOT NULL DEFAULT false,
  tarefa_criada  boolean     NOT NULL DEFAULT false,
  concluido_em   timestamptz,
  criado_por     bigint      REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz
);
CREATE INDEX ON atendimentos (prazo) WHERE excluido_em IS NULL AND workflow <> 'concluido';

-- Comentários viviam DENTRO do registro e sumiam quando duas pessoas
-- escreviam ao mesmo tempo — cada uma via só o próprio texto. Como
-- linha, os dois textos coexistem sem ninguém programar fusão.
CREATE TABLE comentarios (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entidade       text        NOT NULL,          -- 'devolucao' | 'atendimento' | 'tarefa' | 'compra'
  entidade_id    bigint      NOT NULL,
  texto          text        NOT NULL,
  autor_id       bigint      REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz
);
CREATE INDEX ON comentarios (entidade, entidade_id, criado_em);

CREATE TABLE envios (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pedido_id      bigint      REFERENCES pedidos(id),
  codigo         text        NOT NULL,
  transportadora text,
  status         text,
  ultimo_evento  text,
  ultimo_evento_em timestamptz,
  entregue_em    timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz
);
CREATE UNIQUE INDEX ON envios (codigo) WHERE excluido_em IS NULL;


-- ═══ 4. COMPRAS ════════════════════════════════════════════════════
--
-- A aba mais complexa do sistema, e a que guarda mais decisão de
-- negócio. Três etapas: Orçamento → Chegada/Conferência → Estoque.
-- Hoje tudo isso mora num objeto aninhado (`orc`, `conf`, `lanc`)
-- dentro de um registro. Aqui cada peça é uma linha, o que permite
-- duas pessoas mexerem em etapas diferentes da mesma compra.

CREATE TABLE compras (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fornecedor     text        NOT NULL DEFAULT '',
  data           date        NOT NULL DEFAULT CURRENT_DATE,
  transportadora text,
  armazem        text,
  rastreio       text,
  taxa_entrega   numeric(12,2) NOT NULL DEFAULT 0,
  cotacao_usd    numeric(10,4) NOT NULL DEFAULT 5.40,
  obs            text,
  status         text        NOT NULL DEFAULT 'Aguardando',
  etapa          smallint    NOT NULL DEFAULT 1,   -- 1 orçamento · 2 conferência · 3 estoque
  orcamento_travado   boolean NOT NULL DEFAULT false,
  conferencia_travada boolean NOT NULL DEFAULT false,
  conferido      boolean     NOT NULL DEFAULT false,
  arquivado      boolean     NOT NULL DEFAULT false,
  criado_por     bigint      REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz
);
CREATE INDEX ON compras (arquivado, data DESC) WHERE excluido_em IS NULL;

-- Uma linha por produto da compra. As duas etapas convivem na mesma
-- linha porque falam do MESMO produto: o que foi pedido (etapa 1) e o
-- que chegou (etapa 2). Foi a separação dos dois que fez a ficha
-- mostrar o preço do orçamento onde devia mostrar o da conferência.
CREATE TABLE compra_itens (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  compra_id      bigint      NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  ordem          smallint    NOT NULL DEFAULT 0,
  produto        text        NOT NULL DEFAULT '',
  sku            text,
  ean            text,
  -- etapa 1, orçamento
  qtd_comprada   integer     NOT NULL DEFAULT 0,
  preco_unit_usd numeric(12,2),
  -- etapa 2, conferência
  qtd_chegou     integer,
  peso_kg        numeric(10,3),
  vencimento     date,
  preco_ml       numeric(12,2),
  preco_atacado  numeric(12,2),
  conferido_em   timestamptz,
  conferido_por  bigint      REFERENCES usuarios(id),
  -- resultado: custo unitário em BRL, já com frete e taxas rateados
  custo_final    numeric(12,2),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON compra_itens (compra_id, ordem);
CREATE INDEX ON compra_itens (sku);

-- As caixas de cada produto na conferência (quantidade por volume).
CREATE TABLE compra_item_caixas (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  compra_item_id bigint      NOT NULL REFERENCES compra_itens(id) ON DELETE CASCADE,
  ordem          smallint    NOT NULL DEFAULT 0,
  quantidade     integer     NOT NULL DEFAULT 0
);
CREATE INDEX ON compra_item_caixas (compra_item_id, ordem);

CREATE TABLE compra_rastreios (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  compra_id      bigint      NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  codigo         text        NOT NULL DEFAULT '',
  valor          numeric(12,2)
);

-- Os custos que entram no rateio. `obrigatorio` reproduz a regra que
-- hoje é a constante ETP_CUSTOS_OPCIONAIS: Frete Usa 1 e 2,
-- Transportadora, Frete Azul, Taxa SP, Correios e Extravio podem ficar
-- em branco; o resto trava a passagem de etapa.
CREATE TABLE compra_custos (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  compra_id      bigint      NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  rotulo         text        NOT NULL,
  valor          numeric(12,2) NOT NULL DEFAULT 0,
  obrigatorio    boolean     NOT NULL DEFAULT true,
  UNIQUE (compra_id, rotulo)
);


-- ═══ 5. ESTOQUE ════════════════════════════════════════════════════

-- Espelho do catálogo da Base. Escrito só pela integração; a tela lê.
CREATE TABLE produtos (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku            text        NOT NULL UNIQUE,
  base_id        text,
  nome           text        NOT NULL DEFAULT '',
  ean            text,
  peso_kg        numeric(10,3),
  altura_cm      numeric(10,2),
  largura_cm     numeric(10,2),
  comprimento_cm numeric(10,2),
  ncm            text,
  duracao        text,
  preco_site     numeric(12,2),
  sincronizado_em timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON produtos (ean);

-- A fila de lançamento: a tela pede, o n8n executa na Base e escreve
-- de volta o que aconteceu.
CREATE TABLE entradas_estoque (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  compra_id      bigint      REFERENCES compras(id) ON DELETE SET NULL,
  compra_item_id bigint      REFERENCES compra_itens(id) ON DELETE SET NULL,
  sku            text,
  nome           text        NOT NULL DEFAULT '',
  ean            text,
  quantidade     integer     NOT NULL DEFAULT 0,
  custo          numeric(12,2),
  preco_ml       numeric(12,2),
  preco_atacado  numeric(12,2),
  armazem        text,
  novo_na_base   boolean     NOT NULL DEFAULT false,
  obs            text,
  status         text        NOT NULL DEFAULT 'aguardando',
                 -- 'aguardando' → 'pendente' → 'lancado' | 'erro'
  erro           text,
  lancado_em     timestamptz,
  criado_por     bigint      REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON entradas_estoque (status);
CREATE INDEX ON entradas_estoque (compra_id);


-- ═══ 6. TAREFAS ════════════════════════════════════════════════════

CREATE TABLE tarefas (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo         text        NOT NULL,
  descricao      text,
  prioridade     text        NOT NULL DEFAULT 'normal',  -- normal · alta · urgente
  vencimento     date,
  prazo_horas    integer,
  responsavel_id bigint      REFERENCES usuarios(id),
  status         text        NOT NULL DEFAULT 'aberta',
  concluido_em   timestamptz,
  concluido_por  bigint      REFERENCES usuarios(id),
  origem         text,                          -- 'manual' | 'rotina' | 'n8n' | 'atendimento'
  origem_ref     text,
  criado_por     bigint      REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz
);
CREATE INDEX ON tarefas (responsavel_id, status) WHERE excluido_em IS NULL;
CREATE INDEX ON tarefas (vencimento) WHERE excluido_em IS NULL AND status <> 'concluida';

-- ─── A ROTINA DIÁRIA, e por que ela muda de forma ─────────────────
-- Os quatro quadros (WhatsApp, Marketplaces, Pedidos, Anúncios) são
-- uma LISTA FIXA de itens que se repete todo dia. Hoje o "concluído"
-- é um booleano dentro do item, dentro do quadro, dentro do pacote —
-- e foi por isso que a conclusão de um voltava atrás quando o pacote
-- de outro chegava.
--
-- Aqui a definição e a execução se separam:
--   `rotina_itens`      o que existe para fazer (muda raramente)
--   `rotina_execucoes`  quem fez, o quê, em que dia (uma linha por
--                       conclusão)
--
-- Uma conclusão passa a ser uma LINHA COM AUTOR E HORA. Desfazer
-- exige um DELETE explícito. A virada do dia deixa de apagar nada:
-- amanhã é simplesmente outro `dia`, e o histórico fica.
CREATE TABLE rotina_itens (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quadro         text        NOT NULL,   -- 'whatsapp'|'plataformas'|'envios'|'anuncios'
  grupo          text        NOT NULL DEFAULT '',
  chave          text        NOT NULL,   -- 'wpp_a2' — o id de hoje, preservado
  texto          text        NOT NULL,
  sub            text,
  link           text,
  link_rotulo    text,
  repeticoes     smallint    NOT NULL DEFAULT 1,
  ordem          smallint    NOT NULL DEFAULT 0,
  ativo          boolean     NOT NULL DEFAULT true,
  UNIQUE (quadro, chave)
);

CREATE TABLE rotina_responsaveis (
  rotina_item_id bigint      NOT NULL REFERENCES rotina_itens(id) ON DELETE CASCADE,
  usuario_id     bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  PRIMARY KEY (rotina_item_id, usuario_id)
);

CREATE TABLE rotina_execucoes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rotina_item_id bigint      NOT NULL REFERENCES rotina_itens(id) ON DELETE CASCADE,
  dia            date        NOT NULL,
  concluido_por  bigint      NOT NULL REFERENCES usuarios(id),
  concluido_em   timestamptz NOT NULL DEFAULT now(),
  /* Item com repetição (ex.: conferir 3 marketplaces) gera uma linha
     por execução; `sequencia` diz qual delas é. Para item comum é 1. */
  sequencia      smallint    NOT NULL DEFAULT 1,
  UNIQUE (rotina_item_id, dia, sequencia)
);
CREATE INDEX ON rotina_execucoes (dia DESC);
CREATE INDEX ON rotina_execucoes (concluido_por, dia DESC);


-- ═══ 7. RASTRO ═════════════════════════════════════════════════════

-- O feed de "quem fez o quê", que hoje vive em suplelive/activity.
CREATE TABLE atividade_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id     bigint      REFERENCES usuarios(id),
  acao           text        NOT NULL,
  alvo           text,
  secao          text,
  em             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON atividade_log (em DESC);

-- A auditoria campo a campo. Foi ela que permitiu recuperar as
-- conclusões perdidas em agosto, quando o registro já não tinha mais
-- a informação — vale manter.
CREATE TABLE auditoria (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entidade       text        NOT NULL,
  entidade_id    bigint      NOT NULL,
  campo          text        NOT NULL,
  de             text,
  para           text,
  usuario_id     bigint      REFERENCES usuarios(id),
  em             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON auditoria (entidade, entidade_id, em DESC);


-- ═══ 8. INTEGRAÇÕES ════════════════════════════════════════════════

-- Cada chamada que o n8n faz e cada webhook que a Base manda deixam
-- linha aqui. Hoje, quando um fluxo falha, a única pista é o log do
-- n8n — e foi por isso que "a Base lida em 28/08" passou dias sem
-- ninguém notar.
CREATE TABLE integracao_execucoes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fluxo          text        NOT NULL,          -- 'pedidos', 'estoque', 'entrada-estoque'
  direcao        text        NOT NULL,          -- 'entrada' (webhook) | 'saida' (consulta)
  iniciado_em    timestamptz NOT NULL DEFAULT now(),
  terminado_em   timestamptz,
  sucesso        boolean,
  registros      integer     NOT NULL DEFAULT 0,
  erro           text
);
CREATE INDEX ON integracao_execucoes (fluxo, iniciado_em DESC);


-- ═══════════════════════════════════════════════════════════════════
-- AINDA NÃO MODELADO — fase seguinte
-- ═══════════════════════════════════════════════════════════════════
-- WhatsLive (contatos, conversas, mensagens, etiquetas) — é o módulo
--   maior e tem forma própria, com histórico importado do Chatwoot.
-- Base Conhecimento, modelos de mensagem, projetos e notas.
-- Cancelamentos e cancelamentos com NF.
-- Pedidos de imagem e o vínculo com o R2.
-- Não estão aqui porque modelar mal é pior que não modelar: cada um
-- merece a mesma leitura que estes oito blocos tiveram.
