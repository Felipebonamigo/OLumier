-- ============================================================================
--  A VELOCIDADE E AS FALHAS DO ENVIO, MEDIDAS
-- ============================================================================
--
--  Felipe, 30/09/2026, depois de duas queixas no mesmo dia (uma de download
--  lento, uma de envio que caía): "temos que ter velocidade e funcionar".
--
--  O download do ZIP já deixava rastro (`entregas_zip`, com bytes e duração).
--  O envio de fotos não deixava NENHUM: o arquivo vai do navegador direto para
--  o armazém, e quando ele desiste, a única testemunha é a tela do fotógrafo —
--  soubemos da Alícia porque ela mandou foto. Aqui cada arquivo que termina
--  (subiu ou desistiu) vira uma linha, e o painel de administração mostra a
--  velocidade real e as falhas antes de alguém precisar reclamar.
--
--  `ms` é o tempo do envio do ORIGINAL (o PUT), sem as derivadas nem a
--  confirmação — é a parte que depende da rede. Nulo quando desistiu.
--  `navegador` é um resumo ("Safari · macOS"), não o user-agent inteiro.
-- ============================================================================

create table if not exists envios_medidos (
  id          bigserial primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  galeria_id  uuid references galerias(id) on delete set null,
  bytes       bigint not null check (bytes >= 0),
  ms          integer check (ms >= 0),
  ok          boolean not null,
  erro        text,
  navegador   text,
  criado_em   timestamptz not null default now()
);

create index if not exists idx_envios_medidos_quando on envios_medidos(criado_em desc);
create index if not exists idx_envios_medidos_falhas on envios_medidos(criado_em desc) where not ok;
