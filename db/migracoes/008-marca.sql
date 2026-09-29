-- ============================================================================
--  008 — a marca do estúdio deixa de ser só leitura
--
--  `logo_url` existia desde o começo e era LIDA na capa da galeria, com cuidado:
--  a logo substitui o nome em texto (quase toda logo de fotógrafo já contém o
--  nome, e mostrar os dois deixa a capa com o nome duas vezes) e o `alt` recebe
--  o nome do estúdio, para quem usa leitor de tela.
--
--  Só que nunca existiu tela para GRAVAR. A coluna estava NULL em todos os
--  estúdios, e a única forma de o fotógrafo ter a logo dele na capa era alguém
--  editar o banco na mão. A funcionalidade estava construída pela metade —
--  justamente a metade que o cliente vê.
--
--  O RENOME NÃO É COSMÉTICO: não existe URL pública neste bucket (o domínio
--  público está desligado e não há domínio personalizado). O que dá para guardar
--  é a CHAVE do objeto, assinada na hora de exibir — mesmo caminho das fotos.
--  Manter o nome `logo_url` guardando uma chave criaria exatamente o tipo de
--  mentira que a gente acabou de pagar caro para descobrir na política de CORS.
--
--  Renomear é seguro aqui porque a coluna está NULL em toda linha: não há dado
--  para converter, só um nome para corrigir antes de existir dado.
-- ============================================================================

-- ── POR QUE O RENOME É GUARDADO ───────────────────────────────────────────
--
-- Renomear não tem `if not exists`, e num banco NOVO esta migração encontrava
-- a coluna já com o nome novo — porque `db/schema.sql` é o retrato de depois
-- daqui — e parava a fila inteira em cima de nada a fazer. O efeito não era só
-- barulho: montar um banco do zero (uma máquina nova, o CI) ficava impossível
-- sem alguém saber de cabeça em qual migração o retrato parou.
--
-- A guarda não muda nada onde a migração já rodou: lá ela está registrada e não
-- roda de novo. Ela só faz o caminho do banco novo existir.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tenants' and column_name = 'logo_url'
  ) then
    alter table tenants rename column logo_url to logo_chave;
  end if;
end
$$;

comment on column tenants.logo_chave is
  'Chave do objeto da logo no bucket (não é URL: o link é assinado na exibição).';

comment on column tenants.cor_destaque is
  'Cor de destaque do estúdio, em #rrggbb. Usada na capa e na vitrine /e/<slug>.';
