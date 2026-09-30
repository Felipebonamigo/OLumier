-- ============================================================================
--  PASTAS E STREAM SÓ PARA AS CONTAS LIBERADAS
-- ============================================================================
--
--  Felipe, 30/09/2026, ao publicar os estilos de pastas e stream: "isso só
--  ficará visível para sócios primeiramente (eu, Carol, Sirius)".
--
--  Mesmo desenho do `pixieset_liberado_em` (migração 051): um carimbo de data
--  por conta, ligado e desligado por um botão na ficha do estúdio no Admin.
--  Contas de admin (`ADMINS`) já veem sem carimbo — ver
--  `src/config/formatos-liberados.ts`.
--
--  ── QUEM JÁ USA NÃO PERDE A ENTREGA ─────────────────────────────────────
--
--  Os formatos ficaram abertos a todo estúdio entre a publicação da manhã de
--  30/09 e esta. Uma conta que nesse intervalo pôs uma galeria em pastas ou
--  stream (publicada, em rascunho, ou no padrão do estúdio) já tem cliente
--  olhando para ela — e a trava, sozinha, trocaria essa entrega pela galeria
--  de sempre sem ninguém pedir. Essas contas nascem liberadas; o admin
--  bloqueia na ficha se não for o caso.

alter table tenants add column if not exists formatos_liberados_em timestamptz;

update tenants t
   set formatos_liberados_em = now()
 where t.formatos_liberados_em is null
   and (
         coalesce(t.aparencia_padrao ->> 'formato', 'galeria') <> 'galeria'
      or exists (
           select 1 from galerias g
            where g.tenant_id = t.id
              and (   coalesce(g.aparencia ->> 'formato', 'galeria') <> 'galeria'
                   or coalesce(g.aparencia_rascunho ->> 'formato', 'galeria') <> 'galeria')
         )
   );
