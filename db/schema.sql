-- ============================================================================
--  FOTÔNIO — schema inicial (multi-tenant)
--  Postgres no VPS. Aplicar com: node --env-file=.env.local scripts/db.mjs db/schema.sql
--
--  Termos neutros de propósito: nada de "fotonio" em nome de tabela, para o
--  caso de a marca mudar. Ver src/config/marca.ts.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- TENANT — cada fotógrafo/estúdio assinante
-- ---------------------------------------------------------------------------
create table if not exists tenants (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,          -- vira /g/<slug>/<galeria>
  nome_estudio    text not null,
  email           text unique not null,
  senha_hash      text not null,

  -- marca do tenant (o que o cliente final vê)
  logo_chave      text,                          -- chave no bucket, não URL: o link é assinado na exibição
  cor_destaque    text default '#f0c268',

  -- plano e quota (ver src/config/planos.ts)
  plano_id        text not null default 'foto-100',
  quota_bytes     bigint not null default 107374182400,   -- 100 GB
  usado_bytes     bigint not null default 0,              -- mantido por trigger

  -- assinatura (Asaas)
  asaas_cliente_id     text,
  asaas_assinatura_id  text,
  status          text not null default 'trial'
                  check (status in ('trial','ativo','inadimplente','cancelado')),
  trial_ate       timestamptz default (now() + interval '14 days'),

  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- GALERIA — uma entrega (um casamento, um ensaio)
-- ---------------------------------------------------------------------------
create table if not exists galerias (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,

  slug            text not null,                 -- "ana-e-pedro"
  titulo          text not null,
  subtitulo       text,                          -- "Serra Gaúcha"
  data_evento     date,
  capa_media_id   uuid,                          -- FK adicionada depois de `medias`

  -- acesso do cliente final
  senha_hash      text,                          -- null = link sem senha
  publicada       boolean not null default false,
  expira_em       timestamptz,                   -- null = sem prazo

  -- ciclo de vida do cofre: online -> arquivada (B2) -> reativando
  estado          text not null default 'online'
                  check (estado in ('online','arquivada','reativando')),
  arquivada_em    timestamptz,

  permite_download boolean not null default true,
  bytes_total     bigint not null default 0,     -- mantido por trigger

  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),

  unique (tenant_id, slug)
);

-- ---------------------------------------------------------------------------
-- MEDIA — cada foto ou vídeo. `bytes` é o que sustenta quota e custo.
-- ---------------------------------------------------------------------------
create table if not exists medias (
  id              uuid primary key default gen_random_uuid(),
  galeria_id      uuid not null references galerias(id) on delete cascade,
  tenant_id       uuid not null references tenants(id) on delete cascade,

  chave           text not null unique,          -- caminho no bucket: <tenant>/<galeria>/<uuid>.jpg
  nome_original   text not null,
  tipo            text not null check (tipo in ('foto','video')),
  mime            text not null,
  bytes           bigint not null,
  largura         int,
  altura          int,
  duracao_seg     int,                           -- só vídeo

  ordem           int not null default 0,
  pronto          boolean not null default false, -- upload confirmado

  criado_em       timestamptz not null default now()
);

alter table galerias
  drop constraint if exists galerias_capa_media_fk;
alter table galerias
  add constraint galerias_capa_media_fk
  foreign key (capa_media_id) references medias(id) on delete set null;

-- ---------------------------------------------------------------------------
-- ACESSOS — quem abriu/baixou. Serve de prova de entrega para o fotógrafo.
-- ---------------------------------------------------------------------------
create table if not exists acessos (
  id          bigserial primary key,
  galeria_id  uuid not null references galerias(id) on delete cascade,
  media_id    uuid references medias(id) on delete set null,
  acao        text not null check (acao in ('abriu','baixou','baixou_tudo','assistiu')),
  ip_hash     text,                              -- hash, nunca o IP cru (LGPD)
  user_agent  text,
  criado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ÍNDICES
-- ---------------------------------------------------------------------------
create index if not exists idx_galerias_tenant   on galerias(tenant_id);
create index if not exists idx_medias_galeria    on medias(galeria_id, ordem);
create index if not exists idx_medias_tenant     on medias(tenant_id);
create index if not exists idx_acessos_galeria   on acessos(galeria_id, criado_em desc);

-- ---------------------------------------------------------------------------
-- USO DE ESPAÇO — mantido por trigger. É a base da quota E do nosso custo,
-- então tem que ser exato: contamos só media com upload confirmado (pronto).
-- ---------------------------------------------------------------------------
create or replace function recalcular_uso() returns trigger
language plpgsql as $$
declare
  v_galeria uuid;
  v_tenant  uuid;
begin
  v_galeria := coalesce(new.galeria_id, old.galeria_id);
  v_tenant  := coalesce(new.tenant_id,  old.tenant_id);

  update galerias g
     set bytes_total = coalesce((
           select sum(m.bytes) from medias m
            where m.galeria_id = v_galeria and m.pronto
         ), 0),
         atualizado_em = now()
   where g.id = v_galeria;

  update tenants t
     set usado_bytes = coalesce((
           select sum(m.bytes) from medias m
            where m.tenant_id = v_tenant and m.pronto
         ), 0),
         atualizado_em = now()
   where t.id = v_tenant;

  return null;
end $$;

drop trigger if exists trg_uso on medias;
create trigger trg_uso
  after insert or update of bytes, pronto or delete on medias
  for each row execute function recalcular_uso();
