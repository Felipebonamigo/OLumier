-- ============================================================================
--  ATÉ CINCO ESTILOS PRÓPRIOS, COM NOME
-- ============================================================================
--
--  Juan, 28/09/2026: "Adicionar opção de 5 modelos personalizados das
--  combinações individuais de cada pessoa. Ela pode salvar até 5 padrões
--  próprios e dar nome pra eles." E o motivo, na mensagem seguinte: "Eu criei
--  uns 3 que eu gostei, mas só pode salvar um."
--
--  A migração 036 tinha deixado a porta aberta de propósito: "se um dia alguém
--  quiser guardar vários, esta coluna continua sendo o que está EM USO, e a
--  lista nasce ao lado sem migrar nada". É isto. `tenants.aparencia_padrao`
--  continua sendo o design com que toda galeria nova nasce; esta tabela guarda
--  as combinações que o fotógrafo quer ter à mão — e qualquer uma delas pode
--  virar o padrão com um clique.
--
--  ── O LIMITE DE CINCO ─────────────────────────────────────────────────────
--
--  É o número do pedido, e é também o que mantém a escolha uma escolha: com
--  vinte estilos salvos, a tela de Estilos vira um arquivo morto. O limite é
--  conferido no código dentro de uma transação que trava a linha do estúdio
--  (`lib/estilos-do-estudio.ts`) — dois cliques ao mesmo tempo não passam de
--  cinco.
--
--  ── O NOME ────────────────────────────────────────────────────────────────
--
--  Obrigatório, até 40 letras, e único no estúdio sem diferenciar maiúscula:
--  dois estilos chamados "Clean" e "clean" são a mesma pergunta duas vezes.
--
--  `aparencia` é o mesmo jsonb de `galerias.aparencia`, lido pela mesma
--  `lerAparencia` — um eixo novo no futuro não pede migração aqui.

create table if not exists estilos_do_estudio (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  nome           text not null check (char_length(btrim(nome)) between 1 and 40),
  aparencia      jsonb not null,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create index if not exists idx_estilos_do_estudio_tenant
  on estilos_do_estudio (tenant_id, criado_em);

create unique index if not exists idx_estilos_do_estudio_nome
  on estilos_do_estudio (tenant_id, lower(btrim(nome)));

comment on table estilos_do_estudio is
  'Até 5 combinações de aparência salvas pelo estúdio, com nome. O padrão das galerias novas continua em tenants.aparencia_padrao.';
