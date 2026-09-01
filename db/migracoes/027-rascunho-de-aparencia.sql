-- O rascunho da aparência.
--
-- ── O DEFEITO QUE ESTA COLUNA CONSERTA (01/09/2026) ────────────────────────
--
-- Até 31/08 o editor de aparência gravava a cada clique. O dono pediu um botão
-- "Publicar", e o botão entrou — junto com um jeito de perder trabalho que não
-- existia antes: quem escolhia e saía da tela sem apertar perdia a escolha, em
-- silêncio.
--
-- Aconteceu no mesmo dia, com a primeira usuária de verdade. A Carol escolheu o
-- tema claro, viu a prévia ficar branca, saiu — e a galeria seguiu preta. No
-- banco, `aparencia` estava `{}`: nada tinha sido gravado.
--
-- A saída não é voltar ao salvamento automático (o pedido do botão é legítimo:
-- experimentar não pode mexer na galeria que o cliente está vendo). É separar as
-- duas coisas que estavam grudadas:
--
--   aparencia            o que o CLIENTE vê. Só muda quando alguém publica.
--   aparencia_rascunho   o que o FOTÓGRAFO está experimentando. Grava sozinho,
--                        e ninguém além dele vê.
--
-- Assim nada se perde — inclusive trocando de aparelho, o que o navegador
-- sozinho não resolveria — e publicar continua sendo um ato.
--
-- Nula por padrão: sem rascunho, o editor abre no que está publicado, que é o
-- comportamento de sempre.

alter table galerias
  add column if not exists aparencia_rascunho jsonb;
