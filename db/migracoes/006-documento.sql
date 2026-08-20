-- ============================================================================
--  006 — CPF/CNPJ do titular
--
--  O Asaas exige cpfCnpj para criar cliente. Sem isso, a PRIMEIRA assinatura
--  real falha — o código chamava garantirCliente() sem o campo e ninguém nunca
--  perguntou o documento em lugar nenhum.
--
--  Fica nulo de propósito: o teste grátis não precisa de documento, e pedir CPF
--  antes da pessoa experimentar só derruba a conversão. É preenchido na hora de
--  ativar a assinatura, que é quando o Asaas realmente precisa dele.
-- ============================================================================

alter table tenants add column if not exists cpf_cnpj text;

comment on column tenants.cpf_cnpj is
  'Só dígitos, sem pontuação. Nulo enquanto o estúdio não assinar.';
