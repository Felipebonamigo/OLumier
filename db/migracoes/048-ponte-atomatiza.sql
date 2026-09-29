-- ============================================================================
--  A PONTE COM O ATOMATIZA — o estúdio também tem conta lá?
-- ============================================================================
--
--  Quem usa as duas plataformas ganha, no cabeçalho do painel, o seletor
--  "Galeria Átomo | Atomatiza" (Felipe, 29/09/2026: "só vai aparecer pra quem
--  tem cadastro nas duas plataformas").
--
--  Quem sabe que a conta existe lá é o Atomatiza. Cada vez que alguém abre o
--  painel de lá, o servidor de lá pergunta ao nosso (`/api/ponte/conta`) se o
--  e-mail — ou o CPF/CNPJ da empresa — tem conta aqui. Se tem, a resposta é
--  sim e esta coluna ganha a data. É assim que ficamos sabendo, sem perguntar
--  nada ao Atomatiza a cada tela do nosso painel.
--
--  A data, e não um booleano, porque conta apagada lá não avisa ninguém: o
--  seletor some sozinho depois de 30 dias sem visita (ver
--  `src/lib/ponte-atomatiza.ts`).
--
--  Nulo é o estado normal: nunca vimos este estúdio pelo Atomatiza.

alter table tenants add column if not exists atomatiza_visto_em timestamptz;

comment on column tenants.atomatiza_visto_em is
  'Última vez que o Atomatiza perguntou por este estúdio e achou conta aqui. Liga o seletor de plataforma no painel. Ver src/lib/ponte-atomatiza.ts.';
