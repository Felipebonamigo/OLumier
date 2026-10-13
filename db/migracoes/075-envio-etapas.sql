-- ============================================================================
--  O ENVIO, ETAPA POR ETAPA: ONDE O TEMPO DE CADA FOTO VAI
-- ============================================================================
--
--  Felipe, 13/10/2026: a Melannie Fotografia subiu 8,8 GB (uns 410 arquivos
--  de infantil) e levou 30 minutos a mais que no Pixieset. As medidas que já
--  existiam mostraram o que NÃO era: a internet dela e a rota até o armazém
--  estavam boas (cada original subia a 0,5–6,7 MB/s, todos com `ok`, sem
--  erro), e a busca por rosto estava desligada.
--
--  O que a conta deixou de fora: somando o tempo do PUT do original de cada
--  foto e dividindo pelo relógio da pasta, a média foi de 2,6 envios ao mesmo
--  tempo — a fila abre SEIS vagas. O PUT ocupou 43% do tempo das vagas; os
--  outros 57% (uns 22 s por foto) são tempo que ninguém media: gerar a
--  miniatura, o pedido de preparo, a confirmação, e a tentativa que falhou e
--  esperou 2, 5, 15, 30 ou 60 s para ser refeita. `envios_medidos.ms` só
--  guarda o PUT da tentativa que deu certo; uma tentativa que caiu e foi
--  refeita não deixava rastro nenhum.
--
--  Cada coluna é o tempo, em ms, de UMA etapa da tentativa que deu certo (a
--  última). Nulas quando o navegador é antigo, ou quando a etapa não existe
--  (arquivo em partes não passa pela confirmação).
--
--    espera_ms     na fila do processador de miniaturas (`MINIATURAS_JUNTAS`)
--    miniatura_ms  decodificar a foto e gerar miniatura e preview (e o EXIF)
--    preparo_ms    o pedido ao servidor que reserva o arquivo e assina o envio
--    derivadas_ms  o que as miniaturas ainda demoraram DEPOIS do original
--    confirmar_ms  o servidor conferindo que o arquivo chegou
--    total_ms      da vaga ocupada ao fim, com TODAS as tentativas e esperas
--    tentativas    quantas vezes o arquivo foi tentado (1 = de primeira)
--    sem_rede      o navegador ficou sem rede em algum momento do arquivo
--
--  `total_ms` menos a soma das etapas (com `ms`, o PUT) é o "perdido": o que
--  as tentativas refeitas e as esperas entre elas levaram.
-- ============================================================================

alter table envios_medidos
  add column if not exists espera_ms    integer check (espera_ms >= 0),
  add column if not exists miniatura_ms integer check (miniatura_ms >= 0),
  add column if not exists preparo_ms   integer check (preparo_ms >= 0),
  add column if not exists derivadas_ms integer check (derivadas_ms >= 0),
  add column if not exists confirmar_ms integer check (confirmar_ms >= 0),
  add column if not exists total_ms     integer check (total_ms >= 0),
  add column if not exists tentativas   smallint check (tentativas >= 1),
  add column if not exists sem_rede     boolean;
