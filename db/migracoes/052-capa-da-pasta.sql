-- ============================================================================
--  A CAPA DA PASTA — cada capítulo com a sua foto de frente
-- ============================================================================
--
--  30/09/2026: a entrega ganhou o formato "Pastas" (ver `Formato` em
--  `src/config/aparencia.ts`). A galeria abre mostrando os capítulos como
--  pastas, cada uma com uma foto de capa, e as fotos ficam dentro.
--
--  Sem escolha, a capa é a primeira foto do capítulo — que costuma ser a
--  primeira do Lightroom, e nem sempre a melhor (o making of começa no detalhe
--  do sapato). Esta coluna guarda a escolha do fotógrafo, e só isso.
--
--  Mesma forma da `galerias.capa_media_id`, pelos mesmos motivos:
--
--    · `on delete set null` — apagar a foto não apaga o capítulo; a pasta
--      volta a usar a primeira foto, sem ninguém perceber um buraco;
--    · nulo é o estado normal, e é o que todo capítulo existente tem: nada
--      muda para quem não escolheu.
--
--  A foto escolhida precisa ser DO capítulo. Quem garante é a escrita
--  (`definirCapaDaPasta` em `src/lib/secoes.ts`), e a leitura confere de novo:
--  foto movida para outro capítulo depois de virar capa deixa de valer ali, e
--  a pasta volta para a primeira — capa de "Festa" mostrando a cerimônia seria
--  pior que capa nenhuma.

alter table secoes
  add column if not exists capa_media_id uuid references medias(id) on delete set null;
