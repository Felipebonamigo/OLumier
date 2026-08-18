-- Cobrança: liga o estúdio à assinatura no Asaas.
-- As colunas asaas_cliente_id e asaas_assinatura_id já existiam no schema inicial;
-- aqui entram só os campos de acompanhamento.
alter table tenants add column if not exists assinatura_criada_em timestamptz;
alter table tenants add column if not exists ultimo_pagamento_em  timestamptz;

-- Índice para o webhook achar o estúdio rápido pela assinatura.
create index if not exists idx_tenants_assinatura on tenants(asaas_assinatura_id);
