-- LIXEIRA: apagar galeria passa a ser reversível por 30 dias.
--
-- Até aqui, apagar destruía a linha do banco E os objetos do bucket na mesma
-- ação, sem desfazer. Olhando o risco de perder dado com honestidade, esse era
-- o caminho MAIS provável de todos — mais que a Cloudflare falhar, mais que a
-- conta ser suspensa. O fornecedor tem durabilidade de onze noves; o dedo
-- humano não tem nenhuma.
--
-- A lixeira é um estado a mais no ciclo de vida que já existia, e não uma
-- coluna solta de "apagado": o `estado` já governa online/arquivada/reativando,
-- e um segundo lugar dizendo se a galeria existe criaria duas verdades para a
-- mesma pergunta — com o risco garantido de uma consulta filtrar por uma e
-- esquecer a outra.

alter table galerias drop constraint if exists galerias_estado_check;
alter table galerias add constraint galerias_estado_check
  check (estado in ('online','arquivada','reativando','lixeira'));

-- Quando entrou na lixeira. É daqui que sai a contagem do prazo — e o motivo de
-- não reaproveitar `arquivada_em`: uma galeria pode ter ido para o cofre meses
-- antes de alguém apagá-la, e as duas datas contam coisas diferentes.
alter table galerias add column if not exists apagada_em timestamptz;

comment on column galerias.apagada_em is
  'Quando foi para a lixeira. Nulo fora dela. A limpeza definitiva usa esta data.';

-- A limpeza pergunta sempre "o que está na lixeira há mais de 30 dias?".
create index if not exists idx_galerias_lixeira
  on galerias (apagada_em)
  where estado = 'lixeira';
