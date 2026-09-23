-- O SERVIDOR DE ZIP: o pedido que atravessa para outra máquina, e o registro
-- em bytes do que foi entregue.
--
-- ── DE ONDE VEIO (23/09/2026) ──────────────────────────────────────────────
--
-- O ZIP era montado dentro do VPS: cada original vinha do B2 e passava pelo
-- servidor que também atende os outros 13 sites. Felipe: "não podemos limitar
-- o download, eles pagam pelo armazenamento", e "não podemos deixar o VPS
-- lento". As duas juntas só fecham tirando os bytes do VPS — o ZIP passa a ser
-- montado num servidor à parte, que guarda o arquivo pronto e o entrega
-- quantas vezes pedirem (ver docs/servidor-zip.md).
--
-- ── POR QUE O PEDIDO VIRA LINHA NO BANCO ──────────────────────────────────
--
-- O navegador é REDIRECIONADO para o servidor de ZIP, e lá não há cookie: nem
-- a senha da galeria nem a identificação de quem escolheu as favoritas
-- atravessam. Então quem decide o que entra no ZIP é o app, ANTES do
-- redirecionamento, com as travas de sempre (`prepararEntrega`), e grava aqui a
-- lista resolvida. O servidor de ZIP só lê o pedido pelo id — que vai assinado
-- na URL, para o id não ser adivinhável.
--
-- `entradas` é a lista já com o nome de cada arquivo dentro do zip, decidido
-- pelo app (`lib/entradas-do-zip.ts`): o nome depende do capítulo, do grupo das
-- soltas e de haver duas "DSC_0001.jpg", e essa decisão fica num lugar só. A
-- galeria inteira e o capítulo são o que o servidor pode GUARDAR em disco,
-- porque a mesma pergunta dá a mesma resposta para todo mundo; favoritas e
-- recorte são de uma pessoa só.
--
-- ── POR QUE UMA TABELA DE ENTREGAS COM BYTES ──────────────────────────────
--
-- `acessos` registra que alguém baixou, e nada mais. Para saber SE o desenho
-- está custando o que se previu — franquia do B2, tráfego do servidor — é
-- preciso contar bytes, separando o que foi MONTADO (leu o B2) do que foi
-- SERVIDO do arquivo guardado (não leu). É o que o painel de administração lê.
-- O ZIP abortado no meio também entra: é justamente o desperdício que antes
-- não deixava rastro.

create table if not exists pedidos_zip (
  id          uuid primary key default gen_random_uuid(),
  galeria_id  uuid not null references galerias(id) on delete cascade,
  tipo        text not null check (tipo in ('tudo','capitulo','favoritas','recorte')),
  secao_id    uuid references secoes(id) on delete cascade,
  /* [{ id, nome, tamanho, versao }] — ver `EntradaGravada` em lib/pedidos-zip.ts */
  entradas    jsonb not null,
  nome_do_zip text not null,
  /* Quem pediu, pseudonimizado como em `acessos`. O servidor de ZIP não recebe
     cookie nem sessão; o IP de quem baixa é o que o app viu no clique. */
  ip_hash     text,
  user_agent  text,
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null default now() + interval '12 hours'
);

create index if not exists idx_pedidos_zip_expira on pedidos_zip(expira_em);

create table if not exists entregas_zip (
  id          bigserial primary key,
  pedido_id   uuid references pedidos_zip(id) on delete set null,
  galeria_id  uuid references galerias(id) on delete set null,
  tenant_id   uuid references tenants(id) on delete set null,
  tipo        text not null check (tipo in ('tudo','capitulo','favoritas','recorte')),
  /* 'vps' = montado dentro do app (o caminho de reserva, quando não há
     servidor configurado); 'servidor' = pelo servidor de ZIP. */
  origem      text not null check (origem in ('vps','servidor')),
  /* montado  = leu os originais no armazém e escreveu o ZIP
     servido  = entregou o ZIP a alguém (do arquivo guardado ou em fluxo)
     abortado = a conexão caiu no meio; `bytes` é o que chegou a sair */
  evento      text not null check (evento in ('montado','servido','abortado')),
  bytes       bigint not null default 0,
  do_cache    boolean not null default false,
  duracao_ms  integer,
  criado_em   timestamptz not null default now()
);

create index if not exists idx_entregas_zip_mes on entregas_zip(criado_em desc);
create index if not exists idx_entregas_zip_galeria on entregas_zip(galeria_id, criado_em desc);

-- A versão do conteúdo de uma mídia. Sobe a cada republicação (o plugin do
-- Lightroom reedita e sobe a mesma foto, com a mesma chave). É o que faz o ZIP
-- guardado no servidor deixar de valer quando uma foto muda sem mudar de nome
-- nem, às vezes, de tamanho: a versão entra na chave de cache.
alter table medias add column if not exists versao integer not null default 1;
