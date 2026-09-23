-- A capa como ARQUIVO PRÓPRIO, e não obrigatoriamente uma foto da entrega.
--
-- ── O PEDIDO (04/09/2026) ──────────────────────────────────────────────────
--
-- O sócio: "adicionar uma área de selecionar capa: escolher se será de alguma
-- galeria já existente ou se será através da importação de algum arquivo."
--
-- Metade disso já existia e estava escondida: `capa_media_id` aponta para uma
-- foto da galeria, e o botão que a define mora em cada miniatura da grade —
-- quem não rolasse a grade não encontrava.
--
-- A outra metade não existia. A capa TINHA de ser uma foto da entrega, então
-- quem quisesse uma arte na capa (um convite, um cartão com o nome do casal)
-- precisava subi-la como foto — e ela aparecia no meio das outras para o casal,
-- ocupava quota como entrega e ia junto no "baixar tudo".
--
-- ── POR QUE UMA COLUNA, E NÃO UMA LINHA EM `medias` ────────────────────────
--
-- Uma mídia marcada como "só capa" precisaria de um filtro novo em TODO lugar
-- que lista foto: a grade do painel, a galeria do cliente, o baixar tudo, a
-- busca por rosto, o cálculo de quota, o ZIP que ainda não existe. Esquecer um
-- desses entrega ao casal uma foto que nunca foi dele.
--
-- Uma coluna com a chave do objeto é o mesmo desenho da logo do estúdio
-- (`tenants.logo_chave`), que já provou servir: o arquivo mora no bucket, o
-- banco guarda só a chave, e o link é assinado na hora de desenhar a página.
--
-- ── A ORDEM DA CAPA, DEPOIS DESTA MIGRAÇÃO ─────────────────────────────────
--
--   1. `capa_chave`      o arquivo que o fotógrafo enviou de propósito
--   2. `capa_media_id`   a foto da galeria que ele escolheu
--   3. a primeira foto   quando ele não escolheu nada
--
-- A enviada vence a escolhida porque é a decisão mais recente e mais explícita:
-- ninguém sobe uma arte de capa por acidente.

alter table galerias
  add column if not exists capa_chave text;

comment on column galerias.capa_chave is
  'Chave no bucket de uma imagem enviada só para ser capa. Não é uma linha em '
  '`medias`: não aparece na galeria, não conta como entrega e não vai no '
  'download. Vence capa_media_id. Ver src/lib/capa-galeria.ts.';
