-- AUDITORIA: quem fez o quê, e quando.
--
-- Numa disputa, o fotógrafo dirá "o sistema apagou minhas fotos". A diferença
-- entre pagar e não pagar é conseguir mostrar que às 14h32 do dia 3 foi a conta
-- DELE que clicou em apagar. Sem registro, a palavra dele vale tanto quanto a
-- nossa — e o ônus de provar diligência é de quem opera o serviço.
--
-- ── SEM CHAVE ESTRANGEIRA, E ISSO É O PONTO ───────────────────────────────
-- `tenant_id` e `alvo_id` são identificadores soltos, sem `references`. Uma
-- chave estrangeira com cascata faria o registro morrer junto com a galeria
-- apagada ou com a conta encerrada — destruindo exatamente a evidência que ele
-- existe para guardar, e justamente nos dois momentos em que alguém questiona o
-- que aconteceu.
--
-- Como o alvo pode não existir mais, o que importa para ler o evento depois
-- (título da galeria, quantidade de arquivos, plano antigo e novo) fica copiado
-- dentro de `detalhe`. Log que depende de join com uma linha apagada não é log.

create table if not exists eventos (
  id          bigserial primary key,

  -- Sem FK de propósito (ver acima). Nulo quando não há sessão.
  tenant_id   uuid,
  -- Copiado no momento do evento: a conta pode ser encerrada e renomeada.
  estudio     text,

  ator        text not null check (ator in ('estudio','sistema','cliente')),
  acao        text not null,
  alvo_tipo   text,
  alvo_id     text,
  detalhe     jsonb not null default '{}'::jsonb,

  -- Hash, nunca o IP cru (LGPD) — mesma convenção da tabela `acessos`.
  -- Prova que dois eventos vieram do mesmo lugar sem guardar de onde.
  ip_hash     text,

  criado_em   timestamptz not null default now()
);

comment on table eventos is
  'Log de auditoria append-only. Sem FK de proposito: precisa sobreviver a '
  'exclusao da galeria e ao encerramento da conta que registra.';

create index if not exists idx_eventos_tenant on eventos (tenant_id, id desc);
create index if not exists idx_eventos_alvo on eventos (alvo_id);
create index if not exists idx_eventos_data on eventos (criado_em desc);

-- ── SÓ ESCREVE, NUNCA REESCREVE ───────────────────────────────────────────
-- Log que pode ser alterado depois não prova nada: em juízo, a primeira
-- pergunta é se o registro poderia ter sido ajustado. O banco recusa update e
-- delete para que a resposta seja não — inclusive para quem opera o sistema.
--
-- A limpeza dos testes desliga o gatilho explicitamente; é a única saída, e ela
-- deixa rastro no código de quem a usou.

create or replace function eventos_sao_imutaveis() returns trigger as $$
begin
  raise exception 'eventos e append-only: % nao e permitido', tg_op;
end;
$$ language plpgsql;

drop trigger if exists eventos_sem_update on eventos;
create trigger eventos_sem_update before update on eventos
  for each row execute function eventos_sao_imutaveis();

drop trigger if exists eventos_sem_delete on eventos;
create trigger eventos_sem_delete before delete on eventos
  for each row execute function eventos_sao_imutaveis();
