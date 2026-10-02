-- ============================================================================
--  O PACOTE NUMA FATURA SÓ — a assinatura desta conta é a do pacote?
-- ============================================================================
--
--  Felipe, 30/09/2026: "tem que permitir assinar juntos, e o Asaas ou o
--  sistema fazer a separação depois que ele pagar". Quem assina Galeria +
--  Atomatiza pelo botão do pacote ganha UMA assinatura no Asaas, dos dois
--  produtos (`docs/pacote.md`, "Fatura única"). O `asaas_assinatura_id` da
--  conta continua sendo o dela — é esta coluna que diz que ela é do pacote, e
--  guarda o estúdio de lá que a divide com a gente.
--
--  Com ela preenchida: a conferência do combo não mexe no valor (já é o do
--  pacote), e mudar de plano ou cancelar vai pelo WhatsApp — sozinho, um lado
--  desmontaria a fatura do outro.
--
--  Nulo é o estado normal: assinatura só da Galeria, ou nenhuma.

alter table tenants add column if not exists pacote_atomatiza_id text;

comment on column tenants.pacote_atomatiza_id is
  'Estúdio do Atomatiza com quem a assinatura desta conta é dividida (fatura única do pacote). Nulo = assinatura só da Galeria. Ver docs/pacote.md.';
