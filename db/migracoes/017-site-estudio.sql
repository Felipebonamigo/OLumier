-- SITE DO ESTÚDIO: a vitrine `/e/<slug>` ganha conteúdo próprio.
--
-- Até aqui o subdomínio do estúdio (siriusfotografia.olumier.com.br) mostrava
-- só a lista de galerias públicas: nenhum texto, nenhuma forma de contato,
-- nenhum sinal de quem é o fotógrafo. O concorrente (Pixieset) entrega
-- exatamente isso como produto separado, e é a primeira página que o casal vê
-- antes de contratar.
--
-- JSONB e não colunas, pelo mesmo motivo da migração 002 (aparência da
-- galeria): os campos vão crescer — mais seções, mais eixos de estilo — e cada
-- campo novo viraria uma migração. Aqui é chave nova no objeto, e estúdio
-- antigo que não tem a chave cai no padrão do código (`lerSite`, em
-- src/lib/site-estudio.ts).
--
-- O default `{}` importa: `lerSite({})` devolve um site DESLIGADO, então esta
-- migração não muda nada do que já está no ar. Quem não preencher nada continua
-- com a lista de galerias de sempre.
alter table tenants add column if not exists site jsonb not null default '{}'::jsonb;

comment on column tenants.site is
  'Conteúdo da vitrine em /e/<slug>: capa, sobre, depoimentos, contato e estilo. '
  'Formato validado na leitura por lerSite() — o banco não confere nada aqui. '
  'ATENÇÃO: whatsapp e instagram viram href na página pública; são guardados '
  'como dígitos e nome de usuário, nunca como endereço. Ver src/lib/site-estudio.ts.';
