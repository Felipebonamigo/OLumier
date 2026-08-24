-- ============================================================================
--  009 — "esqueci minha senha"
--
--  Até aqui só existia o caminho manual: alguém rodava scripts/redefinir-senha.mjs
--  e passava a senha nova por WhatsApp. Funciona com um cliente; não funciona
--  quando o fotógrafo precisa entrar num domingo à noite.
--
--  DUAS DECISÕES QUE VALEM EXPLICAÇÃO:
--
--  1) Guardamos o HASH do token, nunca o token.
--     O dump do banco sai todo dia às 03:40 e vai para o B2. Se o token
--     estivesse em texto puro, quem tivesse uma cópia do backup poderia assumir
--     qualquer conta cujo pedido ainda estivesse na validade. O hash torna o
--     dump inútil para isso — e não custa nada, porque quem valida sempre tem o
--     token em mãos e pode recalcular.
--
--  2) `senha_alterada_em` existe para DERRUBAR SESSÕES ANTIGAS.
--     A sessão é um cookie assinado, sem registro no servidor: não há como
--     revogar uma por uma. Sem esta coluna, alguém que tivesse roubado o cookie
--     continuaria dentro da conta por até 30 dias DEPOIS da troca de senha — ou
--     seja, exatamente no cenário em que a pessoa troca a senha porque
--     desconfia que alguém entrou. A validação compara quando o cookie foi
--     emitido com esta data; cookie mais velho que a última troca não vale mais.
--
--  Nas contas que já existem a coluna recebe `criado_em`, não `now()`: usar
--  `now()` deslogaria todo mundo no instante da migração, sem motivo.
-- ============================================================================

create table if not exists recuperacoes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  token_hash  text not null,
  expira_em   timestamptz not null,
  usado_em    timestamptz,
  criado_em   timestamptz not null default now(),
  -- Só para investigar abuso depois; não é usado para decidir nada.
  origem      text
);

comment on column recuperacoes.token_hash is
  'sha256 do token. O token em si nunca é gravado — o dump diário iria junto.';

-- A busca do fluxo é sempre por token_hash; único porque token repetido seria
-- ambíguo na hora de decidir de quem é o pedido.
create unique index if not exists idx_recuperacoes_token on recuperacoes(token_hash);
create index if not exists idx_recuperacoes_tenant on recuperacoes(tenant_id, criado_em desc);

alter table tenants add column if not exists senha_alterada_em timestamptz;
update tenants set senha_alterada_em = criado_em where senha_alterada_em is null;
alter table tenants alter column senha_alterada_em set not null;
alter table tenants alter column senha_alterada_em set default now();

comment on column tenants.senha_alterada_em is
  'Cookie de sessão emitido antes disto deixa de valer — ver src/lib/auth.ts.';
