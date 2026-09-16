-- ============================================================================
--  FAVORITAS POR PESSOA — e isto DESFAZ a migração 019, de propósito
-- ============================================================================
--
--  Felipe, 15/09/2026: "criar um sistema de cadastro de e-mail para acessar o
--  menu favoritas, para que cada usuário tenha as suas favoritas, para que eu
--  não tire as favoritas da noiva por exemplo".
--
--  Ele descreveu um defeito real. Desde a 019 a lista é UMA por galeria:
--  `minhasFavoritas` lê todas as favoritas da galeria e `alternar` apaga por
--  `galeria_id + media_id`, sem olhar quem marcou. Qualquer pessoa com o link
--  desmarca a escolha da noiva — inclusive o próprio fotógrafo conferindo a
--  entrega.
--
--  ── POR QUE A 019 FEZ O CONTRÁRIO, E POR QUE MUDAMOS DE NOVO ───────────────
--
--  A 010 tinha exatamente este modelo: uma lista por visitante. A 019 colapsou
--  em lista única para o casal escolher JUNTO — a noiva no celular e o noivo no
--  notebook vendo a mesma escolha. Era uma boa razão, e o preço dela só apareceu
--  com galeria entregue a convidado: quem escolhe junto é o casal, mas quem
--  recebe o link é o casamento inteiro.
--
--  A volta não é um "estávamos errados": é a mesma decisão com um dado novo.
--
--  ── O QUE IDENTIFICA UMA PESSOA É O E-MAIL, NÃO O COOKIE ───────────────────
--
--  O cookie assinado por galeria continua existindo, mas ele identifica o
--  NAVEGADOR. A noiva abre no celular e no notebook: dois cookies, uma pessoa
--  só. Por isso a identidade mora aqui, com o e-mail como chave, e o cookie
--  passa a guardar apenas "quem você disse que é", para ela não redigitar.
--
--  O e-mail NÃO é conferido (decisão do Felipe em 15/09/2026). Isto separa
--  listas por honestidade, não por segurança: quem souber o e-mail da noiva e
--  quiser mexer, mexe. É o suficiente para o problema real — convidado que
--  desmarca sem querer — e não põe barreira no caminho de quem só quer escolher
--  foto. Trocar isso por código no e-mail é uma migração futura, não uma
--  reescrita.
-- ============================================================================

-- ── 1. quem escolheu ────────────────────────────────────────────────────────

create table if not exists pessoas_da_galeria (
  id         uuid primary key default gen_random_uuid(),
  galeria_id uuid not null references galerias(id) on delete cascade,
  -- Guardado como veio, para o fotógrafo ler o e-mail do jeito que a pessoa
  -- escreveu. A unicidade é sobre a forma minúscula — ver o índice abaixo.
  email      text not null,
  nome       text,
  criado_em  timestamptz not null default now()
);

comment on table pessoas_da_galeria is
  'Quem se identificou para escolher fotos NESTA galeria. E-mail não conferido: '
  'separa listas, não autentica ninguém.';

comment on column pessoas_da_galeria.galeria_id is
  'A pessoa existe dentro de UMA galeria. O mesmo e-mail em duas galerias são '
  'duas linhas, de propósito: ligar a mesma pessoa entre estúdios diferentes é '
  'informação que ninguém nos autorizou a juntar — a mesma razão do cookie por '
  'galeria em lib/favoritas.ts.';

-- "Ana@Exemplo.com" e "ana@exemplo.com" são a mesma pessoa para qualquer ser
-- humano. Sem isto, a noiva que digita com maiúscula no notebook abre uma
-- segunda lista e acha que perdeu as escolhas dela.
create unique index if not exists idx_pessoas_galeria_email
  on pessoas_da_galeria(galeria_id, lower(email));

-- ── 2. a favorita ganha dono ────────────────────────────────────────────────

alter table favoritas
  add column if not exists pessoa_id uuid references pessoas_da_galeria(id) on delete cascade;

comment on column favoritas.pessoa_id is
  'Dona da escolha. NULL nas linhas anteriores a 15/09/2026, quando a lista era '
  'uma só por galeria — elas continuam contando no painel do fotógrafo, que é '
  'para quem a seleção serve, e não aparecem como "minhas" para ninguém.';

-- ── 3. o índice que desfaz a 019 ────────────────────────────────────────────
--
-- A 019 criou `(galeria_id, media_id)`: uma linha por foto, dona única. Agora
-- são `(galeria_id, media_id, pessoa_id)` — a mesma foto escolhida pela noiva e
-- pelo noivo são duas linhas, como eram na 010.
--
-- O índice velho tem de sair ANTES: mantê-lo impediria a segunda pessoa de
-- escolher uma foto que a primeira já escolheu, que é exatamente o defeito ao
-- contrário.

drop index if exists idx_favoritas_galeria_media;

-- DOIS índices parciais, e não um `nulls not distinct`.
--
-- O jeito curto seria `unique (galeria_id, media_id, pessoa_id) nulls not
-- distinct`, e ele foi escrito primeiro — o servidor recusou: `syntax error at
-- or near "nulls"`. A cláusula existe só do Postgres 15 em diante, e o VPS roda
-- 14.23. Sem ela o Postgres trata cada NULL como valor único, e a mesma foto da
-- lista antiga poderia ser inserida de novo, duplicando o contador do fotógrafo.
--
-- Os dois índices juntos dizem o mesmo em qualquer versão: uma linha por foto
-- POR PESSOA para quem se identificou, e uma linha por foto na lista antiga.
create unique index if not exists idx_favoritas_galeria_media_pessoa
  on favoritas(galeria_id, media_id, pessoa_id) where pessoa_id is not null;

create unique index if not exists idx_favoritas_galeria_media_antiga
  on favoritas(galeria_id, media_id) where pessoa_id is null;

-- O cliente lê "as minhas": galeria + pessoa.
create index if not exists idx_favoritas_pessoa on favoritas(galeria_id, pessoa_id);
