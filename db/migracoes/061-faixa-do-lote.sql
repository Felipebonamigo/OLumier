-- ============================================================================
--  CADA ENVIO RESERVA A SUA FAIXA DE POSIÇÕES
-- ============================================================================
--
--  Equipe da Carol Tedesco, 02/10/2026, subindo de novo a cerimônia de um
--  casamento: "na pasta do note tá em ordem, mas no link tá subindo
--  desorganizado".
--
--  A migração 038 deu um nome a cada envio (`medias.lote`) e passou a contar a
--  posição de cada arquivo como
--
--      base    = max(ordem) + 1 entre as linhas que NÃO são deste lote
--      posicao = base + indice
--
--  A conta é refeita a CADA arquivo. Com um envio só na galeria, a base não
--  mexe — as linhas de fora do lote são as mesmas do começo ao fim. Com DOIS
--  envios ao mesmo tempo (duas abas, dois computadores da equipe, ou o envio
--  que parecia travado e continuava rodando enquanto a pessoa mandava de novo)
--  cada linha de um empurra a base do outro, que empurra a do primeiro. Com
--  seis arquivos no ar e preparo de duração desigual, o arquivo 11 que pede a
--  vaga depois do 12 pega uma base dezenas de posições mais alta e cai depois
--  dele. Medido: 101 de 150 fotos fora do lugar num capítulo, 87 de 150 no
--  outro — e os dois envios eram para capítulos DIFERENTES.
--
--  Agora a base é decidida UMA vez, quando o primeiro arquivo do lote chega, e
--  guardada aqui. `fim` é até onde o lote disse que vai (o navegador sabe
--  quantos arquivos pôs na fila); o lote seguinte começa depois dele, e não no
--  meio — dois envios para o MESMO capítulo saem um inteiro depois do outro.
--
--  A linha só serve enquanto o envio dura. Quem reserva apaga as da mesma
--  galeria com mais de 7 dias; a galeria apagada leva as dela.

create table if not exists lotes_de_envio (
  galeria_id uuid not null references galerias(id) on delete cascade,
  lote       uuid not null,
  base       integer not null,
  fim        integer not null,
  criado_em  timestamptz not null default now(),
  primary key (galeria_id, lote)
);
