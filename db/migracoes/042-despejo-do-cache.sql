-- O DESPEJO: o ZIP pronto que o servidor de ZIP apagou para caber outro.
--
-- ── DE ONDE VEIO (24/09/2026) ──────────────────────────────────────────────
--
-- Felipe: "vou ser avisado quando precisar aumentar o espaço?". O painel
-- estimava pelo que saía do arquivo guardado, e essa conta misturava favoritas
-- (que nunca são guardadas) — um sinal que tanto disparava à toa quanto
-- escondia o disco pequeno de verdade.
--
-- O sinal direto é outro: o servidor, antes de cada montagem, apaga os ZIPs
-- prontos mais antigos quando não há espaço. Cada um desses vira um evento
-- 'despejo', com os bytes que saíram. Um despejo seguido de nova montagem da
-- mesma galeria é o rodízio — o disco pequeno custando leitura do B2 à toa.
alter table entregas_zip drop constraint if exists entregas_zip_evento_check;
alter table entregas_zip
  add constraint entregas_zip_evento_check
  check (evento in ('montado','servido','abortado','despejo'));
