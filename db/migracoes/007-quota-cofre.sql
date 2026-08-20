-- ============================================================================
--  007 — o cofre ganha quota própria
--
--  A home sempre vendeu "galeria + 500 GB de cofre", mas `cofreGb` só existia na
--  página de vendas: o código somava TODAS as mídias do estúdio numa quota só.
--  Mandar galeria para o cofre não liberava espaço nenhum, e os GB de cofre
--  anunciados não existiam em lugar nenhum do sistema.
--
--  Agora são dois baldes de verdade:
--    quota_bytes        → galerias no ar
--    quota_cofre_bytes  → galerias arquivadas
--
--  Fica 0 por padrão e é preenchido por scripts/sincronizar-quotas.mjs, que lê
--  src/config/planos.ts. Repetir os números aqui criaria uma segunda fonte da
--  verdade que envelheceria calada na primeira mudança de plano.
-- ============================================================================

alter table tenants add column if not exists quota_cofre_bytes bigint not null default 0;

comment on column tenants.quota_cofre_bytes is
  'Espaço do cofre (galerias arquivadas), separado de quota_bytes. Vem de planos.ts.';

-- O uso é consultado a cada envio e a cada arquivamento; sem índice isso vira
-- varredura da tabela inteira de mídias do estúdio.
create index if not exists idx_medias_tenant_pronto on medias(tenant_id) include (bytes);
