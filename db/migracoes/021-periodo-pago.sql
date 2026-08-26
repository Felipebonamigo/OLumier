-- PERÍODO PAGO: cancelar para a renovação, não o acesso.
--
-- O furo: `cancelarAssinaturaAction` marcava `status = 'cancelado'` na hora e
-- o portão de envio recusava no mesmo instante. No mensal ninguém notava — o
-- mês cobrado já tinha sido usado. No anual o estrago era claro: o estúdio
-- pagava doze meses de uma vez e, cancelando no segundo, perdia dez meses que
-- estavam pagos. Dinheiro recebido, serviço não entregue.
--
-- `pago_ate` é a resposta a "até quando o dinheiro que já entrou cobre o
-- serviço". Não é fonte de verdade da cobrança — essa é o Asaas — e só é
-- consultada num lugar: o ramo `cancelado` de `situacaoDoTenant`.
--
-- Quem escreve:
--   pagamento confirmado  → agora + 1 mês (ou + 12 se o ciclo for anual)
--   estorno / chargeback  → null, porque o dinheiro voltou
--   cancelamento          → NÃO TOCA. É o ponto inteiro desta migração.
--
-- Ver src/lib/assinatura.ts (`fimDoPeriodoPago`, `efeitoDoEvento`).

alter table tenants add column if not exists pago_ate timestamptz;

comment on column tenants.pago_ate is
  'Ate quando o dinheiro ja recebido cobre o servico. Cancelar nao mexe aqui; estorno zera. Ver src/lib/assinatura.ts.';

-- Retroativo para quem já assina.
--
-- Sem isto o conserto não vale para ninguém que exista hoje: a coluna nasceria
-- nula, e o primeiro estúdio a cancelar cairia no mesmo buraco que a migração
-- veio fechar. O webhook só vai preencher `pago_ate` na PRÓXIMA cobrança.
--
-- A data do último pagamento não está registrada (`ultimo_pagamento_em` existe
-- desde a 005 e nunca foi escrita), então o melhor palpite disponível é quando
-- a assinatura foi criada. Erra para o lado generoso de propósito: sobrar
-- período custa, no pior caso, um ciclo de envio para quem cancelou; faltar
-- período repete exatamente o defeito.
--
-- Só `ativo`: trial não comprou período, inadimplente e cancelado de hoje não
-- ganham acesso retroativo por causa de uma migração.
update tenants
   set pago_ate = coalesce(ultimo_pagamento_em, assinatura_criada_em, atualizado_em)
                + case when ciclo_cobranca = 'anual' then interval '12 months'
                       else interval '1 month' end
 where status = 'ativo'
   and pago_ate is null;
