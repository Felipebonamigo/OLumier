-- ============================================================================
--  010 — favoritas do cliente
--
--  A dor real: o casal recebe 600 fotos e precisa escolher as do álbum. Hoje
--  isso acontece por WhatsApp, com o casal mandando nomes de arquivo
--  ("IMG_4471, IMG_4488...") e o fotógrafo conferindo um por um.
--
--  QUEM É O "CLIENTE" AQUI: ninguém faz login. A galeria é protegida por link e,
--  às vezes, por senha. Então a lista é por VISITANTE — um id anônimo que vive
--  num cookie assinado, criado na primeira vez que a pessoa marca uma foto.
--
--  Por que anônimo e não pedir nome/e-mail:
--    - pedir cadastro antes de marcar a primeira foto é a forma mais rápida de
--      ninguém marcar nada;
--    - o fotógrafo precisa da LISTA, não da identidade de quem marcou;
--    - e o id ser por galeria (não global) evita ligar a mesma pessoa entre
--      galerias de estúdios diferentes.
--
--  O preço dessa escolha: se a noiva marcar no celular e o noivo no notebook,
--  são duas listas. O painel mostra o total e quantas pessoas marcaram cada
--  foto — o que, para escolher álbum, costuma ser mais útil do que saber o nome
--  de quem marcou: foto marcada pelos dois é escolha óbvia.
-- ============================================================================

create table if not exists favoritas (
  id         uuid primary key default gen_random_uuid(),
  galeria_id uuid not null references galerias(id) on delete cascade,
  media_id   uuid not null references medias(id)   on delete cascade,
  -- Id anônimo do visitante. Não é pessoa identificada: é só o que separa uma
  -- lista da outra dentro da mesma galeria.
  visitante  text not null,
  criado_em  timestamptz not null default now()
);

comment on column favoritas.visitante is
  'Id anônimo por galeria, guardado em cookie assinado. Não identifica pessoa.';

-- Marcar duas vezes a mesma foto é a mesma coisa que marcar uma. Sem isto, um
-- clique duplo (ou uma rede lenta que reenvia) criaria linhas repetidas e o
-- contador do painel mentiria para o fotógrafo.
create unique index if not exists idx_favoritas_media_visitante
  on favoritas(media_id, visitante);

-- O painel lê "as favoritas desta galeria" e o cliente lê "as minhas".
create index if not exists idx_favoritas_galeria on favoritas(galeria_id);
create index if not exists idx_favoritas_visitante on favoritas(galeria_id, visitante);
