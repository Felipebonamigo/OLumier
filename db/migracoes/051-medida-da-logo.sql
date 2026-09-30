-- ============================================================================
--  A MEDIDA DA LOGO
-- ============================================================================
--
--  Um fotógrafo, 30/09/2026: "ou achava muito grande ou muito pequena. Aí
--  tinha que diminuir a própria imagem da logo antes de subir". O tamanho da
--  logo na capa passou a ser pela ÁREA, e não só pela altura (ver
--  `TAMANHO_LOGO` em src/config/aparencia.ts) — e área exige saber a
--  proporção da imagem ANTES de desenhar a capa, no servidor. Medir no
--  navegador depois de carregar faria a logo pular de tamanho em toda visita.
--
--  Largura e altura em pixels do arquivo guardado, já sem a margem vazia que
--  o envio corta. Nulas para quem enviou antes: a capa trata como quadrada
--  até o fotógrafo abrir o editor, que mede e grava (PATCH /api/marca/logo).
--  E enquanto a galeria estiver na regra antiga (`tamanhoLogo` nulo), a
--  medida nem é usada — nada entregue muda de cara com esta migração.
-- ============================================================================

alter table tenants
  add column if not exists logo_largura integer check (logo_largura between 1 and 20000),
  add column if not exists logo_altura  integer check (logo_altura  between 1 and 20000);
