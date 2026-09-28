-- ============================================================================
--  O PEDIDO DE ZIP LEMBRA QUEM PEDIU
-- ============================================================================
--
--  A migração 040 pôs dono na linha de `acessos`, e a rota do ZIP lia o cookie
--  da pessoa antes de montar o arquivo. Entre uma coisa e outra, o servidor de
--  ZIP nasceu (039-servidor-de-zip, de outra frente no mesmo dia) e mudou quem
--  escreve essa linha: agora é `registrarEntregaDeZip`, chamada no evento
--  'servido'.
--
--  Pelo VPS isso não muda nada — a rota ainda tem o cookie na mão. Pelo
--  SERVIDOR DE ZIP muda tudo: ele confirma a entrega chamando
--  `/api/interno/zip/evento` de volta, sem cookie e sem sessão, e de lá só se
--  enxerga o que estiver GRAVADO no pedido.
--
--  Sem esta coluna, todo download da galeria inteira feito pelo caminho novo
--  cairia como "não identificado" na tela que o Juan pediu — e o zip é
--  justamente o download que mais interessa a ele rastrear.
--
--  `on delete set null` pela mesma razão da 040: apagar a pessoa não pode
--  apagar a contagem da entrega.
-- ============================================================================

alter table pedidos_zip
  add column if not exists pessoa_id uuid references pessoas_da_galeria(id) on delete set null;

comment on column pedidos_zip.pessoa_id is
  'Quem clicou em baixar, lido do cookie NA ROTA e congelado aqui. É o único '
  'caminho pelo qual o servidor de ZIP, que não recebe cookie, consegue dizer '
  'de quem foi a entrega quando avisa que terminou.';
