-- ============================================================================
--  A DEVOLUÇÃO AO CANCELAR, E O PRAZO DA CONTA ENCERRADA
-- ============================================================================
--
--  Decisão do Felipe, 30/09/2026, depois de uma revisão de risco de processo
--  ("gente que paga o anual e fecha no meio do caminho", "gente que perde os
--  dados"). Os Termos não diziam nada sobre devolução, e a conta cancelada
--  ficava guardada para sempre sem que texto nenhum dissesse até quando.
--
--  1. `devolucoes`: o que o cancelamento com devolução deve ao estúdio.
--
--     Até 7 dias depois do pagamento do período, tudo volta (arrependimento,
--     art. 49 do CDC). Depois, volta o pago menos os meses começados, cada um
--     pelo preço mensal que aquele pagamento implica — quem sai do anual perde
--     o desconto, não o dinheiro. A regra é `config/devolucao.ts`.
--
--     O estorno NÃO é automático: a cobrança tem split para os sócios, e
--     estorno parcial com split no Asaas não foi ensaiado. A linha nasce
--     pendente, uma pessoa recebe o alerta e estorna no painel do Asaas, e o
--     webhook (PAYMENT_REFUNDED / PAYMENT_PARTIALLY_REFUNDED daquela cobrança)
--     marca `feita_em`. Pendente há dias aparece no caixa dos sócios.
--
--  2. `retencao_*` em `tenants`: o calendário da conta encerrada.
--
--     Cancelada ou inadimplente, a conta fica com as galerias no ar por três
--     meses depois do fim do período pago, com quatro avisos por e-mail — no
--     dia em que o período acaba, e a 30, 7 e 1 dia da data. Depois, os
--     arquivos são apagados. Mesma mecânica do teste abandonado (migração 045),
--     com colunas próprias para os dois calendários não se atropelarem. A regra
--     é `lib/contas-encerradas.ts`.
-- ============================================================================

create table if not exists devolucoes (
  id                bigserial primary key,
  -- Com FK, mas SEM cascata: dinheiro devido não some junto com a conta.
  tenant_id         uuid not null references tenants(id) on delete restrict,
  cobranca_asaas_id text not null,
  valor_centavos    integer not null check (valor_centavos > 0),
  -- Como a conta chegou no valor, para a pessoa que for estornar conferir.
  regra             text not null check (regra in ('arrependimento', 'proporcional')),
  pedida_em         timestamptz not null default now(),
  feita_em          timestamptz
);

-- Uma devolução por cobrança: cancelar duas vezes não devolve em dobro.
create unique index if not exists idx_devolucoes_cobranca on devolucoes (cobranca_asaas_id);
create index if not exists idx_devolucoes_pendentes on devolucoes (pedida_em) where feita_em is null;

alter table tenants add column if not exists retencao_aviso_em timestamptz;
alter table tenants add column if not exists retencao_avisos smallint not null default 0;
alter table tenants add column if not exists retencao_apagar_em timestamptz;

comment on column tenants.retencao_aviso_em is
  'Quando saiu o 1o aviso da conta encerrada. Anterior ao fim do periodo atual = aviso de um ciclo velho, e o calendario recomeca.';
comment on column tenants.retencao_avisos is
  'Quantos dos quatro avisos da conta encerrada ja SAIRAM (envio que falha nao conta).';
comment on column tenants.retencao_apagar_em is
  'A data que o ultimo aviso prometeu. Aviso atrasado empurra a data; nunca puxa.';
