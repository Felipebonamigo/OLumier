-- ============================================================================
--  045 — UMA CONTA DE TESTE POR PESSOA
-- ============================================================================
--
--  Felipe, 28/09/2026: "para criar a conta, precisa de um cpf/cnpj? para
--  garantir que não criem contas repetidas para usar os 10 GB". E, depois de
--  ver as opções: "CPF/CNPJ único no cadastro / Confirmar o e-mail antes de
--  subir fotos / Limite de cadastros por IP / Apagar os arquivos de testes
--  abandonados (ex.: 60 dias após vencer, com aviso por e-mail)".
--
--  O buraco: o teste grátis dá 10 GB (`config/trial.ts`), e nada impedia a
--  mesma pessoa de abrir uma conta nova a cada 14 dias com outro e-mail. As
--  quatro medidas fecham partes diferentes dele; esta migração guarda o que
--  duas delas precisam. O limite por IP não precisa de coluna: conta os
--  eventos `conta.criada`, que já guardam o IP pseudonimizado (migração 014).
--
--  ── 1. CPF/CNPJ ÚNICO ────────────────────────────────────────────────────
--
--  A migração 006 deixou o documento nulo "de propósito: pedir CPF antes da
--  pessoa experimentar só derruba a conversão". Essa decisão foi revista pelo
--  Felipe na data acima — o documento passa a ser pedido no cadastro.
--
--  O índice é PARCIAL (`where cpf_cnpj is not null`): as contas antigas, que
--  nunca informaram documento, continuam válidas e não colidem entre si.
--
--  E é TOLERANTE. Se produção já tiver dois estúdios com o mesmo documento —
--  o mesmo dono com duas contas pagas, por exemplo, o que é legítimo —, criar
--  o índice falharia e derrubaria a publicação inteira. O bloco abaixo pega
--  essa falha, deixa um aviso no log do deploy e segue: a checagem no código
--  (`lib/cadastro.ts`) continua valendo para toda conta nova, e o índice pode
--  ser criado depois, à mão, quando os duplicados forem resolvidos.
--
--  ── 2. E-MAIL CONFIRMADO ─────────────────────────────────────────────────
--
--  `email_confirmado_em` nulo = a pessoa ainda não clicou no link. Só trava o
--  envio de fotos quando o e-mail transacional está LIGADO (`lib/email.ts`):
--  sem ele não há como mandar o link, e exigir o clique seria trancar a conta
--  numa porta que nós não abrimos. Ver `lib/confirmacao-email.ts`.
--
--  Toda conta que já existe nasce confirmada (com a data em que foi criada):
--  ninguém que já usa o produto pode acordar travado por uma regra nova. E o
--  valor padrão é `now()` pelo mesmo motivo — o release antigo, que ainda está
--  no ar no instante entre esta migração e a troca de código, não sabe desta
--  coluna; conta criada por ele nasce confirmada, e não travada. Só o cadastro
--  novo grava nulo, e só quando consegue mandar o link.
--
--  ── 4. TESTE ABANDONADO ──────────────────────────────────────────────────
--
--  Quem testou e sumiu ocupa disco para sempre. A rotina da madrugada
--  (`lib/testes-abandonados.ts`, chamada por `scripts/limpar-lixeira.mjs`)
--  avisa por e-mail, avisa de novo, e só então apaga os ARQUIVOS — a conta
--  fica, para a pessoa poder assinar e recomeçar. As três colunas são o
--  registro de cada passo, para a rotina nunca repetir nem pular um.

do $$
begin
  create unique index if not exists tenants_cpf_cnpj_unico
    on tenants (cpf_cnpj) where cpf_cnpj is not null;
exception when unique_violation then
  raise warning 'tenants.cpf_cnpj tem documentos repetidos em contas antigas; o índice único NÃO foi criado. O cadastro continua conferindo no código (lib/cadastro.ts).';
end $$;

comment on column tenants.cpf_cnpj is
  'Só dígitos, sem pontuação. Pedido no cadastro desde 28/09/2026 (migração 045) e único entre as contas; nulo só em conta anterior a isso.';

alter table tenants add column if not exists email_confirmado_em timestamptz;
update tenants set email_confirmado_em = coalesce(criado_em, now()) where email_confirmado_em is null;
alter table tenants alter column email_confirmado_em set default now();

comment on column tenants.email_confirmado_em is
  'Quando o dono clicou no link de confirmação. Nulo = pendente; só trava o envio com o e-mail transacional ligado.';

create table if not exists confirmacoes_email (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  -- Só o hash, como em `recuperacoes`: o dump do banco sai do servidor todo dia.
  token_hash  text not null unique,
  expira_em   timestamptz not null,
  usado_em    timestamptz,
  criado_em   timestamptz not null default now()
);

create index if not exists idx_confirmacoes_email_tenant on confirmacoes_email (tenant_id);

alter table tenants add column if not exists aviso_limpeza_em timestamptz;
alter table tenants add column if not exists aviso_limpeza_final_em timestamptz;
alter table tenants add column if not exists arquivos_limpos_em timestamptz;

comment on column tenants.aviso_limpeza_em is
  'Primeiro aviso de que os arquivos do teste vencido serão apagados. Gravado só se o e-mail saiu.';
comment on column tenants.aviso_limpeza_final_em is
  'Último aviso antes de apagar. Sem ele gravado, a rotina não apaga nada.';
comment on column tenants.arquivos_limpos_em is
  'Quando os arquivos do teste abandonado foram apagados. A conta continua existindo.';

-- O limite de cadastros por IP pergunta "quantas contas este IP criou nas
-- últimas 24 h". Sem índice, cada cadastro varreria a tabela de eventos toda.
create index if not exists idx_eventos_ip_acao on eventos (ip_hash, acao, criado_em desc)
  where ip_hash is not null;
