-- ============================================================================
--  O ESPAÇO USADO, RECONTADO UMA VEZ POR COMANDO — e não uma vez por linha
-- ============================================================================
--
--  Juan, 01/10/2026, com a Sirius cheia: na Lixeira, o "apagar de vez" de uma
--  galeria de 2.204 arquivos ficava em "Apagando…"; nos capítulos de outra
--  galeria, "clico em renomear, nada acontece", "e depois os outros botões
--  param de funcionar". "Lag demais aqui também."
--
--  O `trg_uso` (db/schema.sql) rodava PARA CADA LINHA de `medias` e, a cada
--  vez, somava os bytes de TODAS as mídias do estúdio para gravar na linha do
--  estúdio. Medido num estúdio de 30.000 arquivos:
--
--    apagar de vez uma galeria de 2.205   9,5 s — 2.205 somas de 30.000
--    inserir 27.796 de uma vez            266 s — cresce ao quadrado
--    confirmar UMA foto enviada            11 ms
--
--  E durante cada um desses segundos a linha do estúdio fica TRAVADA. Toda foto
--  que termina de subir quer gravar nela, espera — e espera segurando uma das
--  10 conexões do banco. Esgotadas, o painel inteiro para, de todo estúdio.
--
--  Agora são três gatilhos POR COMANDO, com as linhas afetadas numa tabela de
--  transição: apagar 2.204 linhas é UMA soma por galeria e por estúdio
--  afetados. A conta continua exata e no mesmo lugar (`galerias.bytes_total`,
--  `tenants.usado_bytes`), só para de ser refeita milhares de vezes.
--
--  No UPDATE, só recalcula quando muda o que entra na conta — bytes, pronto,
--  ou a galeria/estúdio da linha. Reordenar 4.000 fotos (que reescreve
--  `ordem`) não soma nada; o gatilho antigo nem disparava ali (`update of
--  bytes, pronto`), e uma tabela de transição não aceita lista de colunas.
--
--  Três gatilhos e não um: o Postgres não aceita tabela de transição num
--  gatilho de mais de um evento.

create or replace function recalcular_uso_do_comando() returns trigger
language plpgsql as $$
declare
  v_galerias uuid[];
  v_tenants  uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct galeria_id), array_agg(distinct tenant_id)
      into v_galerias, v_tenants
      from novas;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct galeria_id), array_agg(distinct tenant_id)
      into v_galerias, v_tenants
      from antigas;
  else
    select array_agg(distinct x.galeria_id), array_agg(distinct x.tenant_id)
      into v_galerias, v_tenants
      from (
        select n.galeria_id, n.tenant_id, a.galeria_id as galeria_antes, a.tenant_id as tenant_antes
          from novas n
          join antigas a on a.id = n.id
         where n.bytes is distinct from a.bytes
            or n.pronto is distinct from a.pronto
            or n.galeria_id is distinct from a.galeria_id
            or n.tenant_id is distinct from a.tenant_id
      ) mudou
      cross join lateral (
        values (mudou.galeria_id, mudou.tenant_id), (mudou.galeria_antes, mudou.tenant_antes)
      ) as x(galeria_id, tenant_id);
  end if;

  if v_galerias is null then
    return null;
  end if;

  update galerias g
     set bytes_total = coalesce((
           select sum(m.bytes) from medias m
            where m.galeria_id = g.id and m.pronto
         ), 0),
         atualizado_em = now()
   where g.id = any(v_galerias);

  update tenants t
     set usado_bytes = coalesce((
           select sum(m.bytes) from medias m
            where m.tenant_id = t.id and m.pronto
         ), 0),
         atualizado_em = now()
   where t.id = any(v_tenants);

  return null;
end $$;

drop trigger if exists trg_uso on medias;
drop trigger if exists trg_uso_insert on medias;
drop trigger if exists trg_uso_delete on medias;
drop trigger if exists trg_uso_update on medias;

create trigger trg_uso_insert
  after insert on medias
  referencing new table as novas
  for each statement execute function recalcular_uso_do_comando();

create trigger trg_uso_delete
  after delete on medias
  referencing old table as antigas
  for each statement execute function recalcular_uso_do_comando();

create trigger trg_uso_update
  after update on medias
  referencing old table as antigas new table as novas
  for each statement execute function recalcular_uso_do_comando();

drop function if exists recalcular_uso();
