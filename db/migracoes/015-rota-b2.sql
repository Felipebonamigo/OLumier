-- ROTA B2: cada original passa a dizer em qual armazém mora.
--
-- Hoje TUDO vive no Cloudflare R2 a R$ 0,1155/GB/mês (com o espelho junto). A
-- grade de preços de 24/08 foi calculada com R$ 0,046/GB para galeria grande e
-- cofre — o custo do Backblaze B2 — e essa rota nunca foi construída. Enquanto
-- o arquivo pesado não morar lá, 114 das 147 montagens vendem abaixo do custo e
-- retêm 100% do dinheiro no split, sem sócio nenhum receber.
--
-- Esta migração não move nada e não muda comportamento: todo mundo nasce e
-- continua em 'r2'. É só o lugar onde a resposta vai passar a morar, para as
-- fases seguintes (mover, espelhar frio, limpar) entrarem uma de cada vez.
-- Ver docs/obra-rota-b2.md.

-- Por que uma coluna e não uma tabela de localização: no dia de restaurar, o
-- banco tem em mãos a chave do objeto e mais nada. Uma correspondência guardada
-- à parte é uma correspondência que pode se perder justamente no desastre — a
-- chave no B2 é IDÊNTICA à do R2, e esta coluna diz só de qual dos dois ler.
alter table medias add column if not exists armazem text not null default 'r2';

-- O check é o que impede um terceiro valor entrar por engano em algum script e
-- virar arquivo que ninguém sabe onde está. Escrito com drop antes para a
-- migração poder rodar de novo sem estourar.
alter table medias drop constraint if exists medias_armazem_check;
alter table medias add constraint medias_armazem_check
  check (armazem in ('r2','b2'));

comment on column medias.armazem is
  'Onde o ORIGINAL mora: r2 (padrão) ou b2 (galeria grande e cofre, após a mudança). '
  'As derivadas ficam sempre no r2 — são pequenas e regeneráveis.';

-- Quando o original ganhou a cópia fria (Hetzner), que é o espelho de quem tem
-- primário no B2. Anulável pelo mesmo motivo do `espelhado_em` da 012: null é
-- "ainda na fila", o estado normal de todo arquivo recém-movido, e não existe
-- valor "falhou" — tentativa que dá errado continua nula e volta na próxima
-- passada.
--
-- Coluna separada de `espelhado_em` de propósito: são espelhos em EMPRESAS
-- diferentes, e o que importa saber é se existe segunda cópia no lugar certo
-- para o armazém atual. Reaproveitar a mesma coluna faria um arquivo movido
-- para o B2 parecer espelhado quando sua única outra cópia está... no B2.
alter table medias add column if not exists espelho_frio_em timestamptz;

comment on column medias.espelho_frio_em is
  'Quando o original ganhou a cópia fria em outro fornecedor. Nulo = ainda na fila. '
  'Só se aplica a quem tem armazem = b2.';

-- A pergunta que o espelho frio e a conferência de cópias fazem sempre: "o que
-- está no B2 e ainda tem uma cópia só?". Parcial porque a resposta encolhe até
-- quase zero em regime normal — e hoje o índice nasce vazio, já que ninguém
-- está em 'b2' ainda.
create index if not exists idx_medias_sem_espelho_frio
  on medias (criado_em)
  where armazem = 'b2' and espelho_frio_em is null;
