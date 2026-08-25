-- ESPAÇO ÚNICO: o cofre deixa de ter balde próprio.
--
-- Até aqui o estúdio tinha duas quotas: `quota_bytes` para o que está no ar e
-- `quota_cofre_bytes` para o que está arquivado. A separação existia porque o
-- GB no ar e o GB parado custavam diferente. Com tudo indo para o Backblaze B2
-- eles passaram a custar o mesmo, o cofre deixou de ser peça de preço, e manter
-- dois limites virou só atrito — inclusive um bug: `quota_cofre_bytes` nascia
-- zero, então arquivar era RECUSADO para o cliente padrão, na primeira vez que
-- ele tentava usar o recurso que o produto mais vende.
--
-- Ver docs/arquitetura-armazenamento.md.

-- A quota nova é a SOMA das duas. Somar nunca encolhe o espaço de ninguém, que
-- é a única regra inegociável aqui: um estúdio não pode acordar com menos do
-- que contratou. Quem já tinha cofre sai desta migração com mais espaço no ar
-- do que tinha antes — e é isso mesmo, porque agora é tudo o mesmo espaço.
update tenants
   set quota_bytes = quota_bytes + coalesce(quota_cofre_bytes, 0),
       atualizado_em = now()
 where coalesce(quota_cofre_bytes, 0) > 0;

-- A coluna NÃO é removida, de propósito. Um release anterior ainda lê e escreve
-- nela; se o deploy precisar voltar atrás, a coluna some junto com a
-- possibilidade de rollback. Fica zerada e comentada, e sai numa faxina futura,
-- quando nenhum release vivo souber que ela existiu.
update tenants set quota_cofre_bytes = 0 where quota_cofre_bytes <> 0;

comment on column tenants.quota_cofre_bytes is
  'MORTA desde 25/08/2026 (migração 016). O espaço é um só, em quota_bytes — '
  'no ar e arquivado somam. Mantida zerada apenas para permitir rollback; '
  'nenhum código novo lê ou escreve nela.';

comment on column tenants.quota_bytes is
  'Espaço TOTAL do estúdio, em bytes: galerias no ar e arquivadas somadas.';
