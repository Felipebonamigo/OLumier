-- SEM ESPELHO: saem as duas colunas de fila da segunda cópia.
--
-- O espelho de arquivos — cópia dos originais num fornecedor diferente — foi
-- CANCELADO em 26/08/2026, junto com a obra da rota B2. A grade de preços foi
-- recalculada sem ele (R$ 0,0459/GB, ver `config/planos.ts`), mas nada foi
-- desligado: por um dia inteiro dois temporizadores do systemd copiaram e
-- purgaram arquivos para um espelho que a empresa já tinha decidido não ter.
--
-- Esta migração fecha a parte do banco. `espelhado_em` (012) e `espelho_frio_em`
-- (015) eram filas de trabalho, não histórico: `null` significava "ainda não
-- copiado". Sem trabalhador consumindo a fila, os dois viram colunas que ninguém
-- escreve — e coluna assim é armadilha, não resíduo inofensivo. Quem abrir a
-- tabela daqui a três meses e ler `espelhado_em is null` em toda linha vai
-- concluir que o espelho está atrasado, e não que ele não existe.
--
-- `espelho_frio_em` nunca guardou um único valor: era a fila do espelho frio na
-- Hetzner, uma caixa que não chegou a ser comprada.
--
-- Nenhum dado se perde: produção tinha 0 medias em 27/08/2026, e o que estas
-- colunas guardavam era estado de fila, reconstruível por definição — se um dia
-- voltar uma segunda cópia, ela começa com tudo na fila, que é o certo.
--
-- `scripts/testar-sem-espelho.mjs` prende esta remoção inteira: os arquivos, a
-- fiação, o ambiente e o banco.

-- Os índices primeiro: existem só para servir as colunas, e dropar a coluna
-- levaria os dois junto de qualquer jeito. Explícito porque uma migração que
-- apaga por efeito colateral esconde metade do que fez.
drop index if exists idx_medias_sem_espelho;
drop index if exists idx_medias_sem_espelho_frio;

alter table medias drop column if exists espelhado_em;
alter table medias drop column if exists espelho_frio_em;
