-- Seções (capítulos) da galeria: Making Of, Cerimônia, Festa…
--
-- Tabela própria em vez de um texto em `medias`: a seção tem ordem, é renomeada
-- sem tocar nas fotos, e a galeria precisa listar seções vazias (o fotógrafo cria
-- a estrutura antes de subir as fotos de cada momento).
create table if not exists secoes (
  id          uuid primary key default gen_random_uuid(),
  galeria_id  uuid not null references galerias(id) on delete cascade,
  nome        text not null,
  ordem       int  not null default 0,
  criado_em   timestamptz not null default now()
);

create index if not exists idx_secoes_galeria on secoes(galeria_id, ordem);

-- Foto sem seção continua válida: cai no grupo "sem capítulo", exibido primeiro.
-- on delete set null: apagar um capítulo NÃO apaga as fotos dele.
alter table medias add column if not exists secao_id uuid references secoes(id) on delete set null;
create index if not exists idx_medias_secao on medias(secao_id, ordem);
