-- ESPELHO: marca quando cada arquivo ganhou a segunda cópia.
--
-- Até aqui o banco tinha backup e os ARQUIVOS não: foto e vídeo viviam só no
-- R2, uma cópia num fornecedor só. Perder a conta (suspensão, cartão recusado,
-- chave vazada com permissão de apagar) levaria as entregas de todos os
-- clientes de uma vez, e o backup do banco restaurado apontaria para arquivos
-- que não existem mais.
--
-- A coluna é anulável de propósito: `null` significa "ainda na fila", que é o
-- estado normal de todo arquivo recém-enviado. Não existe valor "falhou" —
-- tentativa que dá errado simplesmente continua nula e entra na próxima
-- passada. Guardar contador de erro aqui só criaria um segundo lugar para a
-- verdade morar.

alter table medias add column if not exists espelhado_em timestamptz;

comment on column medias.espelhado_em is
  'Quando o original ganhou a segunda cópia no espelho. Nulo = ainda na fila.';

-- O trabalhador pergunta sempre a mesma coisa: "o que ainda não foi espelhado,
-- mais antigo primeiro?". Índice parcial porque a resposta encolhe até quase
-- zero em regime normal — indexar a tabela inteira seria pagar por linha que
-- nunca aparece na consulta.
create index if not exists idx_medias_sem_espelho
  on medias (criado_em)
  where pronto and espelhado_em is null;
