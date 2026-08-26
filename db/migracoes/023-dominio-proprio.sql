-- ============================================================================
--  020 — domínio próprio do estúdio
--
--  `carolinetedesco.com.br` servindo a vitrine e as galerias, no lugar de
--  `caroline-tedesco-fotografia.olumier.com.br`.
--
--  Ver `docs/dominio-proprio.md` para o desenho inteiro. O resumo do que estas
--  três colunas carregam:
--
--  UM domínio por estúdio, em coluna e não em tabela. É o que o concorrente
--  oferece, é o que resolve o caso real, e tabela para uma linha é degrau a
--  mais da escada. Se um dia alguém precisar de dois, a tabela nasce ali — com
--  o problema já entendido em vez de adivinhado.
--
--  ── POR QUE `dominio_verificado_em` É UMA COLUNA SEPARADA ─────────────────
--  Porque "o estúdio digitou um domínio" e "o estúdio PROVOU que é dele" são
--  fatos diferentes, e confundi-los custa caro:
--
--  Aceitar um domínio é autorizar o Caddy a pedir certificado para ele. Sem a
--  prova, um estúdio digitando `padelizou.com.br` faz o nosso porteiro mandar
--  o Caddy tentar emitir certificado para domínio alheio — e a cota da
--  Let's Encrypt é por SERVIDOR. Neste servidor moram Padelizou, Atomatiza,
--  Poke Panda e Bonamigo Systems. Um erro de digitação de um fotógrafo não pode
--  derrubar a emissão dos outros quatro.
--
--  Então: `dominio_proprio` é o que ele pediu, `dominio_verificado_em` é o que
--  vale. O porteiro e o roteamento leem a SEGUNDA.
-- ============================================================================

alter table tenants
  add column if not exists dominio_proprio       text,
  -- Token do registro TXT. Nasce ao reclamar e vive enquanto o domínio viver:
  -- o estúdio pode precisar reconferir meses depois, e regenerar o token
  -- invalidaria o registro que ele já colocou na zona dele.
  add column if not exists dominio_token         text,
  add column if not exists dominio_verificado_em timestamptz;

comment on column tenants.dominio_proprio is
  'Domínio do estúdio, normalizado (sem esquema, sem www, minúsculo). NULL = usa o subdomínio.';
comment on column tenants.dominio_token is
  'Token do registro TXT de posse. Ver src/lib/dominio-proprio.ts.';
comment on column tenants.dominio_verificado_em is
  'Quando a posse foi provada por DNS. NULL = pedido, não provado — NÃO libera certificado.';

-- Dois estúdios não podem reivindicar o mesmo endereço. Sem isto, o segundo a
-- verificar passaria a receber o tráfego do primeiro — com certificado válido e
-- sem nenhum aviso para o dono.
--
-- `lower()` porque domínio não tem caixa, e o parcial porque NULL é o caso
-- comum: quase todo estúdio fica no subdomínio.
create unique index if not exists idx_tenants_dominio_proprio
  on tenants(lower(dominio_proprio)) where dominio_proprio is not null;
