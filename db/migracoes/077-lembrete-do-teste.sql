-- ============================================================================
--  O LEMBRETE DO FIM DO TESTE
-- ============================================================================
--
--  Uma usuária do teste viu "erro" ao subir uma galeria e não sabia que o teste
--  tinha dois limites — o TEMPO (14 dias) e o ESPAÇO (10 GB) — nem que um deles
--  tinha acabado. Agora a conta é avisada ANTES, por e-mail e na tela inicial
--  das galerias (src/lib/lembrete-do-teste.ts).
--
--  Cada e-mail sai UMA vez por teste, e estas colunas são a memória disso:
--
--    aviso_teste_tempo_em    quando saiu o "seu teste termina em poucos dias".
--                            Vale para o teste ATUAL só se for recente em
--                            relação a `trial_ate`: se o admin estender o
--                            teste, o aviso antigo fica para trás e o novo prazo
--                            ganha o seu próprio.
--    aviso_teste_espaco_em   quando saiu o "o espaço do teste está enchendo".
--
--  Só guardam o instante; nada é lido por tela.
-- ============================================================================

alter table tenants add column if not exists aviso_teste_tempo_em timestamptz;
alter table tenants add column if not exists aviso_teste_espaco_em timestamptz;

comment on column tenants.aviso_teste_tempo_em is
  'Quando saiu o e-mail de teste acabando. Vale para o teste atual só se > trial_ate - 5 dias.';
comment on column tenants.aviso_teste_espaco_em is
  'Quando saiu o e-mail de espaço do teste enchendo (uma vez por conta).';
