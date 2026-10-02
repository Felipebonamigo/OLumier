-- ============================================================================
--  O RECADO DO CLIENTE — a "área de feedbacks" pedida pelo Juan
-- ============================================================================
--
--  Juan, 01/10/2026: "dentro da própria construção da galeria, disponibilizar
--  uma área de feedbacks. Essa função poderá ser ativada ou não para atuar na
--  galeria. Se for ativada, no menu, junto da área das favoritas, vai ter algum
--  símbolo. Clicando ali, as pessoas poderão adicionar um feedback por escrito,
--  ou preencher um formulário de 0 a 5 estrelas, montado e organizado lá na área
--  de feedbacks da organização da galeria. Só o fotógrafo/dono da galeria poderá
--  acessar as respostas."
--
--  ── POR QUE "RECADO", E NÃO "FEEDBACK" ────────────────────────────────────
--
--  Porque quem escreve é o casal, e nenhum casal "dá um feedback" do casamento
--  dele. A palavra do produto, na tela do cliente, é a palavra dele. Dentro do
--  painel do fotógrafo o nome é o mesmo, para não existirem dois vocabulários
--  para a mesma coisa.
--
--  ── POR QUE TABELA PRÓPRIA, E NÃO UMA COLUNA EM `pessoas_da_galeria` ──────
--
--  `pessoas_da_galeria` é identidade, e a linha dela nasce também no DOWNLOAD
--  (`pessoaPorNomeOuEmail`): "Tia Marta" existe sem nunca ter escrito nada, e
--  "quem deixou recado" viraria `where texto is not null` numa tabela cujo
--  trabalho é outro. Além disso `criado_em` ali é QUANDO A PESSOA SE
--  IDENTIFICOU, e o fotógrafo precisa de quando ela escreveu — são dois fatos.
--
--  ── O QUE ACONTECE QUANDO A PESSOA É APAGADA ──────────────────────────────
--
--  `on delete cascade`, e aqui a escolha é o OPOSTO da de `acessos.pessoa_id`
--  (que é `set null`, migração 040, porque apagar a pessoa não pode apagar a
--  CONTAGEM). O recado é a palavra dela: tirar a pessoa tem de levar o texto.
--  Mesma razão de `favoritas.pessoa_id` ser cascade.
--
--  ── O TETO DO TEXTO É 900, E O NÚMERO NÃO É CHUTE ─────────────────────────
--
--  É `LIMITES.depoimentoTexto` (`src/lib/site-estudio.ts`), o teto do depoimento
--  no site do estúdio. O caminho natural deste recado é virar depoimento um dia,
--  e um teto maior aqui faria o passo seguinte cortar o fim da frase de quem
--  escreveu — com a autorização dela já dada.
--
--  ── A AUTORIZAÇÃO PARA USAR COMO DEPOIMENTO ───────────────────────────────
--
--  `autoriza_depoimento` nasce AGORA, com a primeira linha, mesmo sem existir
--  tela que use isso. É o único jeito: a autorização é pedida à pessoa no
--  momento em que ela escreve, e não se pede depois. Sem a coluna desde o
--  começo, todo recado coletado até ela existir seria inutilizável.
--
--  ── DUAS CHAVES, NÃO UMA ──────────────────────────────────────────────────
--
--  `recado_ativo` (texto escrito) e `recado_estrelas` (as perguntas com nota)
--  são interruptores separados. O Juan escreveu "ou" — mas são coisas
--  diferentes: a nota ajuda o fotógrafo a melhorar, a frase é o que ele mostra
--  para vender. Quem quer as duas, liga as duas.

alter table galerias
  add column if not exists recado_ativo boolean not null default false,
  add column if not exists recado_estrelas boolean not null default false,
  -- O convite que o casal lê. Vazio usa o texto padrão do produto.
  add column if not exists recado_convite text,
  -- As perguntas com nota, na ordem: ["Como foi o atendimento?", …]
  add column if not exists recado_perguntas jsonb not null default '[]'::jsonb;

create table if not exists recados (
  id uuid primary key default gen_random_uuid(),
  galeria_id uuid not null references galerias(id) on delete cascade,
  pessoa_id uuid not null references pessoas_da_galeria(id) on delete cascade,
  -- O que a pessoa escreveu. Null = ela só deu as notas.
  texto text,
  -- As notas, por pergunta: {"Como foi o atendimento?": 5}. A pergunta entra
  -- como CHAVE, e não como índice, porque o fotógrafo pode reescrever a lista
  -- depois — e um recado que virasse "pergunta 2: 4" perderia o sentido.
  notas jsonb not null default '{}'::jsonb,
  autoriza_depoimento boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- Um recado por pessoa por galeria: voltar e escrever de novo CORRIGE o que
  -- ela disse, não acrescenta um segundo depoimento da mesma pessoa.
  unique (galeria_id, pessoa_id)
);

-- A leitura do painel é sempre "os recados desta galeria, os novos primeiro".
create index if not exists idx_recados_galeria on recados (galeria_id, criado_em desc);
