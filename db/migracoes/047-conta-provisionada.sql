-- ============================================================================
--  047 — DE ONDE VEIO A CONTA, quando ela não nasceu no formulário de cadastro
--
--  O Atomatiza passa a poder criar a conta da galeria pelo fotógrafo: ele já
--  tem conta lá, e obrigá-lo a preencher um segundo cadastro aqui só para
--  depois gerar uma chave e colar de volta é pedágio sem função. Ver
--  `src/lib/provisionamento.ts` e `POST /api/provisionar`.
--
--  ── POR QUE ISTO É COLUNA, E NÃO SÓ UM BOOLEANO ───────────────────────────
--
--  O que se guarda não é "veio de fora", é QUAL conta de fora. A referência é
--  o id do estúdio no outro sistema, e é OPACA: a gente grava e devolve, nunca
--  interpreta. Mesmo desenho de `galerias.origem_ref` (migração 045).
--
--  E ela existe por um motivo concreto, que é o RETRY. O provisionamento cria
--  o estúdio, manda o e-mail de definir senha e devolve a chave. Se a resposta
--  se perder no caminho — rede, 502, o servidor do outro lado reiniciando —, o
--  Atomatiza mostra erro e o fotógrafo clica de novo. Sem esta coluna, a
--  segunda chamada esbarraria no e-mail único e ele ficaria com uma conta que
--  não consegue ligar: teria de ir até lá, definir a senha e gerar a chave na
--  mão, que é exatamente o que este recurso existe para evitar.
--
--  Com ela, repetir devolve O MESMO estúdio e uma chave nova. Idempotente pela
--  referência, como `POST /api/galerias` já é.
--
--  NULO para quem se cadastrou pelo formulário, que é e seguirá sendo a
--  maioria. A coluna descreve procedência, não estado.
-- ============================================================================

alter table tenants add column if not exists origem     text;
alter table tenants add column if not exists origem_ref text;

comment on column tenants.origem is
  'Quem criou esta conta, quando não foi o formulário de cadastro. Ex.: ''atomatiza''. Nulo = cadastro normal.';
comment on column tenants.origem_ref is
  'O id do estúdio no sistema de origem. Opaco: guardado e devolvido, nunca interpretado.';

-- A trava do retry, e o que impede duas contas para o mesmo estúdio de lá.
--
-- Parcial de propósito: só vale para linha que TEM origem. Sem o `where`, todo
-- cadastro normal (origem e ref nulos) disputaria a mesma entrada nula — e no
-- Postgres nulos não colidem em índice único, então funcionaria por acaso. O
-- `where` diz a intenção em vez de depender desse detalhe.
create unique index if not exists tenants_origem_unica
  on tenants (origem, origem_ref)
  where origem is not null and origem_ref is not null;
