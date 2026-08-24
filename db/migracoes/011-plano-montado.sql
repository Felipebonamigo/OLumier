-- Plano virou quebra-cabeça: o id deixou de ser um de seis nomes fixos e passou
-- a descrever a montagem — `g:<tipo>:<galeria em GB>:<cofre em GB>`.
--
-- Só o DEFAULT da coluna muda aqui. Os ids antigos continuam válidos e
-- congelados no tamanho e no preço que tinham (ver LEGADOS em
-- src/config/planos.ts): reinterpretar um id gravado pela grade nova encolheria
-- a quota de quem já assinou, calado, na próxima sincronização.
--
-- O default é rede de segurança — o código sempre grava o plano explicitamente
-- (PLANO_INICIAL). Ele existe para que uma linha inserida à mão no psql não
-- nasça apontando para um plano que ninguém mais vende.

alter table tenants
  alter column plano_id set default 'g:foto:250:1000';

comment on column tenants.plano_id is
  'Montagem do plano: g:<foto|filme|ambos>:<galeria GB>:<cofre GB>. '
  'Ids sem o prefixo g: são os seis pacotes antigos, mantidos por compatibilidade.';
