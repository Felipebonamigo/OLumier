-- CICLO DE COBRANÇA: o estúdio passa a poder pagar por ano.
--
-- O anual cobra dez meses e entrega doze. Isso é desconto, e desconto muda uma
-- conta que não está nesta tabela: a RESERVA. O split manda embora o lucro na
-- hora em que o pagamento cai, e o que fica na conta é o dinheiro do
-- fornecedor. No mensal isso fecha sozinho — cobrou um mês, reservou um mês.
-- No anual o estúdio paga UMA vez e ocupa o disco por DOZE, então a reserva
-- tem de ser de doze meses, senão o split despacha dinheiro que ainda vai ser
-- gasto em armazenamento. Ver `lucroCentavos` em src/config/socios.ts.
--
-- Por que a coluna precisa existir, em vez de perguntar ao Asaas: o cálculo do
-- split acontece ANTES de qualquer chamada (é ele que monta o corpo da
-- requisição), e a troca de plano recalcula o split. Sem saber o ciclo aqui, a
-- troca de plano de um estúdio anual recalcularia com reserva de um mês.
--
-- 'mensal' como padrão porque é o que TODA assinatura existente é: o
-- `cycle: "MONTHLY"` era fixo no código até hoje. Nenhuma linha muda de
-- significado com esta migração.

alter table tenants
  add column if not exists ciclo_cobranca text not null default 'mensal';

-- O `check` é a rede que a aplicação não pode esquecer de estender: se um dia
-- alguém inventar 'semestral' no TypeScript e não passar por aqui, a gravação
-- falha alto em vez de virar um ciclo desconhecido que o cálculo da reserva
-- trataria silenciosamente como mensal — e reserva curta só aparece meses
-- depois, com a fatura na mão.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tenants_ciclo_cobranca_check'
  ) then
    alter table tenants
      add constraint tenants_ciclo_cobranca_check
      check (ciclo_cobranca in ('mensal', 'anual'));
  end if;
end $$;

comment on column tenants.ciclo_cobranca is
  'mensal ou anual. O anual paga 10 meses por 12 — e reserva custo de 12. Ver src/config/socios.ts.';
