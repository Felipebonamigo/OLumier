-- O LOTE DO ENVIO: o que impede 286 fotos de chegarem embaralhadas.
--
-- ── DE ONDE VEIO ───────────────────────────────────────────────────────────
--
-- Juan, 18/09/2026, com a galeria de 286 arquivos: "não sei o que tá
-- acontecendo, mas não tá em ordem cronológica (…) minhas PB sempre são depois
-- da colorida, mas aqui tá antes".
--
-- ── A CONTA QUE ESCORREGAVA ────────────────────────────────────────────────
--
-- A posição de cada foto nasce em `criarMediaPendente`:
--
--     base    = max(ordem) + 1 entre as fotos PRONTAS da galeria
--     posicao = base + indice        (o índice é o da lista que o navegador ordenou)
--
-- O filtro `pronto` estava lá para segurar a base "durante o envio": as linhas
-- pendentes do próprio lote não entram no cálculo. Isso vale enquanto NENHUM
-- arquivo do lote fica pronto — verdade num teste de três arquivos, e falso num
-- casamento de 286, que leva minutos e vai ficando pronto o tempo todo.
--
-- Com a base subindo e os índices contando do zero, basta um arquivo demorar no
-- preparo (o navegador decodifica e gera miniatura antes de a linha nascer — um
-- RAW ou um HEIC levam muito mais que um JPG pequeno) para ele nascer com uma
-- base alta e cair DEPOIS de arquivos que vieram atrás dele na lista.
--
-- Reproduzido na bancada com 60 arquivos e 4 em paralelo: 60 de 60 fora do
-- lugar, `foto-001` na posição 8. É também o que explica o relato do Juan — a
-- versão preto-e-branco é o arquivo menor, prepara antes e passa na frente da
-- colorida.
--
-- ── POR QUE UMA COLUNA, E NÃO OUTRO JEITO DE CONTAR ───────────────────────
--
-- A base tem de ser a mesma para o lote inteiro, do primeiro ao último arquivo.
-- Para isso é preciso saber quem é "o lote inteiro", e nenhuma coluna existente
-- responde isso: `criado_em` não separa dois envios seguidos, e `ordem` é
-- justamente o que se está calculando.
--
-- Com o lote na linha, a conta vira "o maior `ordem` entre as fotos prontas que
-- NÃO são deste envio" — estável do começo ao fim, por mais que o lote fique
-- pronto no meio do caminho.
--
-- ── NULO É O PASSADO ──────────────────────────────────────────────────────
--
-- Toda foto que já existe tem lote nulo, e continua entrando no cálculo como
-- sempre entrou. Nenhuma galeria muda de ordem por causa desta migração: ela só
-- vale para o que subir depois. O que já subiu embaralhado se conserta no
-- painel, com "ordenar por nome (A→Z)".

alter table medias add column if not exists lote uuid;

-- A base é lida a cada arquivo que nasce, filtrando por galeria, `pronto` e
-- lote. Sem índice isso é uma varredura por arquivo — 286 varreduras num
-- casamento.
create index if not exists idx_medias_ordem_do_lote
  on medias (galeria_id, pronto, lote);

comment on column medias.lote is
  'O envio de que este arquivo fez parte. Segura a base da posição para o lote inteiro — ver criarMediaPendente. Nulo = subiu antes da migração 038.';
