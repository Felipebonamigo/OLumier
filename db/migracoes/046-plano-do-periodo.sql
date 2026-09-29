-- ============================================================================
--  O PLANO JÁ PAGO NO PERÍODO — a base da diferença na troca de plano
-- ============================================================================
--
--  Aumentar o plano no meio do período cobra só a diferença, proporcional ao
--  que falta (ver `src/config/troca-de-plano.ts`). A diferença é contra o plano
--  que JÁ FOI PAGO no período — e não contra o plano de agora, porque quem
--  desce e sobe de novo no mesmo período não pode pagar outra vez o que já
--  pagou.
--
--  Gravada quando a mensalidade é paga (o plano em vigor naquele momento) e
--  quando uma diferença é cobrada (o plano novo). Descer de plano não mexe
--  nela. Nula = ainda não gravada; vale o plano atual.

alter table tenants add column if not exists plano_do_periodo text;

comment on column tenants.plano_do_periodo is
  'Maior plano já pago no período corrente — a base da cobrança da diferença na troca de plano. Nulo = o plano atual. Ver src/config/troca-de-plano.ts.';
