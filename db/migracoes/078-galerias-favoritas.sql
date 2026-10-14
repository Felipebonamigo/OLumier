-- ============================================================================
--  GALERIAS FAVORITAS
-- ============================================================================
--
--  Felipe, 14/10/2026, lembrando do Pixieset: o fotógrafo tem galerias que abre
--  o tempo todo — o portfólio, o acervo analógico, as galerias do Movimento
--  Átomo, os ensaios de posicionamento da Sirius — e hoje elas se perdem no meio
--  da lista, em ordem de data. Favoritar põe a galeria numa faixa própria no topo
--  da tela inicial.
--
--  É preferência do ESTÚDIO sobre a lista dele, não sobre a entrega: o cliente
--  nunca vê, e nada na galeria pública muda. Por isso a marca fica na linha da
--  galeria (o estúdio é um só, não há "favorita de cada sócio").
--
--  `favorita_em` e não um booleano: a data ordena a faixa — a última que o
--  fotógrafo favoritou entra no fim, e a ordem em que ele montou é a que ele vê.
-- ============================================================================

alter table galerias add column if not exists favorita_em timestamptz;

comment on column galerias.favorita_em is
  'Quando o estúdio marcou a galeria como favorita (faixa no topo do painel). Nulo = não é.';

create index if not exists idx_galerias_favoritas
  on galerias (tenant_id, favorita_em)
  where favorita_em is not null;
