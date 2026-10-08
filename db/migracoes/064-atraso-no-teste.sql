-- ============================================================================
--  QUEM VIROU INADIMPLENTE COM O TESTE AINDA VALENDO
-- ============================================================================
--
--  Até 08/10/2026 o aviso "cobrança vencida" do Asaas marcava a conta como
--  `inadimplente` sem olhar o teste (`api/asaas/webhook`). A primeira fatura
--  de uma conta que veio pela ponte do Atomatiza vence na data que o comprador
--  escolheu, com os 14 dias de teste ainda correndo — e Pix/boleto não pago em
--  dia travava o envio de quem ainda tinha dias grátis.
--
--  O código já não faz mais isso. Esta migração desfaz o que ele fez: conta
--  `inadimplente` que NUNCA pagou (`pago_ate` nulo) e cujo teste ainda não
--  acabou só pode ter chegado aí por esse caminho — pagar zera `trial_ate`, e
--  quem já pagou tem `pago_ate`. Volta para `trial`; a fatura em aberto
--  continua no Asaas, e se o teste acabar sem pagamento vale a regra de
--  sempre.
--
--  Quem tem o teste VENCIDO não entra: ali o atraso é atraso. Cada conta
--  corrigida deixa um evento (`conta.status_corrigido`) no registro imutável.
--  Idempotente: rodar de novo não acha mais ninguém.
-- ============================================================================

with corrigidas as (
  update tenants
     set status = 'trial', atualizado_em = now()
   where status = 'inadimplente'
     and pago_ate is null
     and trial_ate > now()
  returning id, nome_estudio, trial_ate
)
insert into eventos (tenant_id, estudio, ator, acao, alvo_tipo, alvo_id, detalhe)
select id, nome_estudio, 'sistema', 'conta.status_corrigido', 'conta', id::text,
       jsonb_build_object(
         'de', 'inadimplente',
         'para', 'trial',
         'motivo', 'atraso_durante_o_teste',
         'trial_ate', trial_ate
       )
  from corrigidas;
