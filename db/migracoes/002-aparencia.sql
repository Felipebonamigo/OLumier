-- Aparência da galeria, em JSONB.
--
-- JSONB e não colunas: os eixos vão crescer (mais capas, mais grades) e cada
-- opção nova viraria uma migração. Aqui é chave nova no objeto, e galeria antiga
-- que não tem a chave cai no padrão do código.
alter table galerias add column if not exists aparencia jsonb not null default '{}'::jsonb;
