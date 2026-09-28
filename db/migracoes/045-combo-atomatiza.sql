-- ============================================================================
--  O COMBO COM O ATOMATIZA — a faixa de lá que a assinatura daqui enxergou
-- ============================================================================
--
--  Quem assina a Galeria Átomo e o Atomatiza paga menos pelos dois, e o
--  desconto é dividido meio a meio (ver `src/config/combo.ts`). A verdade do
--  combo está no Asaas — a assinatura viva do Atomatiza com o mesmo CPF/CNPJ,
--  e o valor que a nossa assinatura cobra. Esta coluna é só o que a última
--  conferência encontrou, para a tela de Conta dizer "combo com o Atomatiza
--  Equipe" sem ir ao Asaas a cada visita.
--
--  Nulo é o estado normal: sem Atomatiza, ou ainda não conferido.

alter table tenants add column if not exists combo_atomatiza text
  check (combo_atomatiza in ('solo', 'equipe', 'estudio'));

comment on column tenants.combo_atomatiza is
  'Faixa do Atomatiza encontrada na última conferência do combo (solo/equipe/estudio). Nulo = sem combo. A verdade é o Asaas; ver src/lib/combo.ts.';
