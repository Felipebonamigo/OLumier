-- ============================================================================
--  O LINK DA BIO: MEDIR O QUE CHEGA, E DE ONDE VEIO QUEM CRIOU CONTA
-- ============================================================================
--
--  Juan, 07/10/2026: o perfil do Instagram passa a falar de dois produtos
--  (Atomatiza e Galeria Átomo), e o link da bio vira uma página-ponte (`/bio`)
--  onde a pessoa escolhe para onde ir. Pedido: saber quantos chegaram, quantos
--  clicaram em cada produto, e — quando der — que quem criou a conta começou
--  pelo Instagram.
--
--  Não havia nenhuma ferramenta de análise no projeto (nem tag, nem pixel), e
--  `eventos` NÃO serve: é o registro de auditoria, imutável, feito para provar
--  quem fez o quê numa disputa — "registrar cada clique encheria a tabela e
--  afogaria justamente os eventos que importam" (`lib/eventos.ts`). Medir
--  tráfego é outra coisa,
--  com outra regra de retenção e nenhuma prova a guardar. Daí a tabela à parte.
--
--  ── O QUE A LINHA GUARDA, E O QUE NÃO ─────────────────────────────────────
--
--  `visitante` é um hash do IP + navegador + DIA, com o sal da plataforma: gira
--  todo dia, então não dá para seguir ninguém de um dia para o outro, e não há
--  cookie. Serve para contar "pessoas por dia", e só isso. É uma estimativa:
--  duas pessoas na mesma rede móvel com o mesmo modelo de celular caem no mesmo
--  hash (conta como uma), e a mesma pessoa em dois dias conta duas vezes.
--
--  Nenhum IP, nenhum e-mail, nenhum identificador que sobreviva à meia-noite.
--
--  ── `evento` NÃO TEM CHECK ────────────────────────────────────────────────
--
--  Os nomes (page_view, click_galeria_atomo, click_atomatiza, click_login_…)
--  moram em `config/bio.ts`, e produto novo é uma linha lá. Um `check (evento in
--  (...))` aqui obrigaria uma migração a cada produto. A API só grava nomes que
--  a configuração conhece.

create table if not exists bio_eventos (
  id        bigserial primary key,
  criado_em timestamptz not null default now(),
  evento    text not null check (char_length(evento) between 1 and 40),
  -- A origem, como `utm_source` / `utm_medium` / `utm_campaign` (já limpos).
  fonte     text,
  meio      text,
  campanha  text,
  -- Hash que gira todo dia. Ver acima.
  visitante text
);

create index if not exists idx_bio_eventos_criado on bio_eventos (criado_em desc);
create index if not exists idx_bio_eventos_evento on bio_eventos (evento, criado_em desc);

comment on table bio_eventos is
  'Medição da página /bio (link da bio do Instagram): visitas e cliques por produto. Sem IP, sem cookie, sem dado pessoal. NÃO é auditoria — essa é `eventos`.';

-- ── A ORIGEM DA CONTA ───────────────────────────────────────────────────────
--
--  Quem clica num produto na /bio ganha um cookie de 30 dias com a origem; ao
--  criar a conta, ela é gravada aqui. `origem` é "fonte/meio/produto" (por
--  exemplo "instagram/bio/galeria"): o produto é o que a pessoa CLICOU na ponte,
--  o que permite ver também quem clicou na Atomatiza e acabou criando conta
--  aqui. Nulo = nasceu sem passar pela ponte (a maioria, e as contas antigas).
alter table tenants add column if not exists origem text;
alter table tenants add column if not exists origem_campanha text;

create index if not exists idx_tenants_origem on tenants (origem) where origem is not null;

comment on column tenants.origem is
  'De onde veio a conta: "fonte/meio/produto" do cookie da página /bio (ex.: instagram/bio/galeria). Nulo = não veio pela ponte.';
