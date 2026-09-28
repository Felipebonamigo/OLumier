-- ============================================================================
--  QUEM BAIXOU, E QUANTAS VEZES CADA FOTO
-- ============================================================================
--
--  Juan, 23/09/2026, com a foto da tela de Atividade do Pixieset: "gostaria de
--  saber quem está baixando. Quais fotos estão sendo baixadas. Existe alguma
--  forma de fazer isso?"
--
--  A tela dele mostrava e-mail, miniatura, nome do arquivo e horário, uma linha
--  por download. A nossa mostrava "41 downloads" e mais nada.
--
--  O engraçado é que quase tudo já estava gravado: `acessos` tem `media_id`
--  (qual foto), `acao` ('baixou'/'baixou_tudo') e `criado_em`. Faltava UMA
--  coluna — quem — e a tela para ler as quatro juntas.
--
--  ── O NOME VALE TANTO QUANTO O E-MAIL (Felipe, 23/09/2026) ─────────────────
--
--  "Quando for baixar pedir nome e email opcional, pelo menos um dos dois."
--
--  A 033 criou `pessoas_da_galeria` com `email not null`, porque ali a
--  identidade servia para SEPARAR listas de favoritas e o e-mail era a chave
--  estável entre o celular e o notebook. Para saber quem baixou, "Tia Marta" na
--  planilha do fotógrafo vale tanto quanto um e-mail — e pedir e-mail
--  obrigatório na frente de cada convidado que quer salvar uma foto é atrito em
--  cima de quem não tem nada a ver com a nossa contabilidade.
--
--  Então o e-mail vira opcional e entra um `check`: uma pessoa precisa ter pelo
--  menos um jeito de ser chamada.
-- ============================================================================

-- ── 1. a pessoa pode ser só um nome ─────────────────────────────────────────

alter table pessoas_da_galeria alter column email drop not null;

-- Vazio não é identidade: "   " no campo salvaria uma linha que não diz nada.
-- O `nullif(btrim(...))` é o mesmo tratamento que a aplicação faz antes de
-- gravar, escrito aqui também porque o banco é a última linha de defesa.
alter table pessoas_da_galeria drop constraint if exists pessoa_tem_como_chamar;
alter table pessoas_da_galeria add constraint pessoa_tem_como_chamar
  check (
    nullif(btrim(coalesce(email, '')), '') is not null
    or nullif(btrim(coalesce(nome, '')), '') is not null
  );

-- Quem se identificou SÓ pelo nome precisa reencontrar a própria linha, senão
-- cada download abre uma "Tia Marta" nova. O índice de e-mail da 033 continua
-- valendo para quem deu e-mail; este cobre o resto.
--
-- Parcial (`where email is null`) de propósito: duas pessoas com o mesmo nome e
-- e-mails diferentes são duas pessoas, e o índice não pode impedir isso.
create unique index if not exists idx_pessoas_galeria_nome
  on pessoas_da_galeria(galeria_id, lower(btrim(nome)))
  where email is null;

-- ── 2. o acesso ganha dono ──────────────────────────────────────────────────

alter table acessos
  add column if not exists pessoa_id uuid references pessoas_da_galeria(id) on delete set null;

comment on column acessos.pessoa_id is
  'Quem fez isto, quando deu para saber. NULL em tudo que é anterior a '
  '23/09/2026 e em quem abriu a galeria sem se identificar — a tela mostra '
  'essas linhas como "não identificado", que é a verdade.';

-- `on delete set null` e não `cascade`: apagar a pessoa não pode apagar a
-- CONTAGEM. O fotógrafo cobra pela entrega e o número de downloads é dela, não
-- da pessoa.

-- ── 3. os índices das duas telas novas ──────────────────────────────────────

-- A lista de "quem baixou o quê", em ordem de quando.
create index if not exists idx_acessos_downloads
  on acessos(galeria_id, criado_em desc)
  where acao in ('baixou','baixou_tudo');

-- "Quantas vezes cada foto foi baixada", que vira a ordenação "mais baixadas".
create index if not exists idx_acessos_media_baixou
  on acessos(media_id)
  where acao in ('baixou','baixou_tudo') and media_id is not null;
