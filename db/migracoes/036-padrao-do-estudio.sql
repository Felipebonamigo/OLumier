-- O PADRÃO DE DESIGN DO ESTÚDIO: a cara que toda galeria nova já nasce tendo.
--
-- ── DE ONDE VEIO ───────────────────────────────────────────────────────────
--
-- Felipe, 16/09/2026: "adicionar algum método de 'salvar padrão criado', para
-- sempre se repetir na hora do design da capa".
--
-- O editor de aparência tem doze eixos e nove estilos prontos. Um fotógrafo
-- acerta a combinação dele uma vez — capa redonda, Bodoni fina, tema creme,
-- grade em colunas, cantos retos — e a partir daí quer ISSO, em toda entrega.
-- Hoje ele refaz as doze escolhas por galeria, ou escolhe um preset nosso que
-- chega perto e ajusta de novo.
--
-- Um estúdio tem UMA identidade visual. O padrão é ela.
--
-- ── POR QUE NO TENANT, E NÃO UM "PRESET SALVO" COM LISTA ──────────────────
--
-- A tentação é uma tabela de presets do usuário, com nome, para ele guardar
-- vários. Ela resolveria um problema que ninguém tem: o pedido é "sempre se
-- repetir", não "escolher entre os meus três". Uma lista traria tela de
-- gerenciamento, nome, ordem, apagar — e a pergunta "qual deles é o de hoje?",
-- que é exatamente a pergunta que o padrão existe para não fazer.
--
-- Uma coluna responde ao pedido inteiro. Se um dia alguém quiser guardar
-- vários, esta coluna continua sendo o que está EM USO, e a lista nasce ao lado
-- sem migrar nada.
--
-- ── NULO É O ESTADO NORMAL ────────────────────────────────────────────────
--
-- Estúdio que nunca salvou um padrão não tem um, e a galeria nova nasce com o
-- `APARENCIA_PADRAO` do código, como sempre nasceu. Nenhuma galeria existente
-- muda de cara por causa desta migração: ela só passa a valer para o que for
-- criado DEPOIS de alguém apertar "salvar como meu padrão".
--
-- `jsonb` e não colunas porque é exatamente o mesmo formato de
-- `galerias.aparencia`, lido pela mesma `lerAparencia` — que valida campo a
-- campo e devolve o padrão do código no que estiver faltando. Um eixo novo no
-- futuro não precisa de migração aqui.

alter table tenants add column if not exists aparencia_padrao jsonb;

comment on column tenants.aparencia_padrao is
  'A aparência que toda galeria nova deste estúdio herda. Nulo = usa o padrão do código. Mesmo formato de galerias.aparencia.';
