-- ============================================================================
--  A GALERIA GRANDE EM PARTES
-- ============================================================================
--
--  Felipe, 10/10/2026, pedindo o "ZIP em partes para galerias grandes": um ZIP
--  de 20 GB sai numa conexão só, e do servidor de ZIP até o Brasil várias
--  conexões rendem bem mais que uma. Em partes de até 4 GB, o navegador baixa
--  várias ao mesmo tempo, e uma queda perde uma parte, não o casamento.
--  Ver `src/lib/partes-do-zip.ts`.
--
--  O servidor de ZIP não muda: cada parte é um pedido com a sua lista, e a
--  chave de cache já sai da lista. O que o APP precisa saber de um pedido é se
--  ele é uma parte, por dois motivos:
--
--   1. A Atividade. Uma parte entregue não é "baixou tudo": quem baixou a
--      parte 1 de 4 não levou o casamento. Parte entra como `baixou`, que é o
--      que o zip de um capítulo já faz.
--   2. As quedas retomadas (migração 050). "O mesmo download" passa a ser
--      também a mesma parte — sem isso, a parte 2 chegando inteira apagaria
--      como "retomada" a queda da parte 3.
--
--  Nulas no pedido de sempre (galeria inteira num ZIP só, capítulo,
--  favoritas, recorte).
-- ============================================================================

alter table pedidos_zip
  add column if not exists parte  smallint,
  add column if not exists partes smallint;

alter table pedidos_zip drop constraint if exists pedidos_zip_parte_valida;
alter table pedidos_zip add constraint pedidos_zip_parte_valida check (
  (parte is null and partes is null)
  or (parte >= 1 and partes >= 2 and parte <= partes)
);
