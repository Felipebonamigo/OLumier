-- ENQUADRAMENTO DA CAPA DE CADA PASTA: onde a foto dela deve ser cortada.
--
-- ── DE ONDE VEIO ───────────────────────────────────────────────────────────
--
-- Juan, 09/10/2026, sobre Design → Formato → Pastas: "adicionar opção de
-- escolher o ponto focal da imagem, para poder deixar a capa da pasta também
-- centralizada da forma que eu quiser".
--
-- O "também" é literal: é o mesmo pedido que ele fez em 08/09 para a capa da
-- GALERIA, que virou a migração 031. Lá o problema era o `object-cover` do CSS
-- decidindo sozinho o que jogar fora; aqui é o mesmo CSS, no mesmo tipo de
-- caixa, com o mesmo resultado — a pasta cortada pelo centro, e o assunto da
-- foto quase nunca está no centro.
--
-- ── AS MESMAS TRÊS DECISÕES DA 031, PELAS MESMAS RAZÕES ───────────────────
--
-- COLUNA, E NÃO DENTRO DE `aparencia`. O foco pertence à FOTO escolhida, não
-- ao tema: trocar de preset não pode mexer no enquadramento, e trocar a foto
-- TEM de zerá-lo — um foco calibrado para a foto A não quer dizer nada na foto
-- B. É a vida da própria escolha de capa, que já mora aqui ao lado em
-- `capa_media_id` / `capa_chave`.
--
-- DOIS SMALLINT, E NÃO UM TEXTO "30% 78%". O valor vai para dentro de um
-- `style` que a galeria do cliente renderiza. Texto livre ali é CSS escolhido
-- por quem grava; dois inteiros com faixa conferida pelo banco não têm como
-- virar outra coisa.
--
-- 50/50, E NÃO NULO. É exatamente o que o `object-cover` já faz sozinho: toda
-- pasta existente nasce com o enquadramento que ela já tem hoje, e nenhuma
-- entrega que está no ar muda de cara por causa desta migração.

alter table secoes
  add column if not exists capa_foco_x smallint not null default 50,
  add column if not exists capa_foco_y smallint not null default 50;

alter table secoes
  drop constraint if exists secoes_capa_foco_faixa;

alter table secoes
  add constraint secoes_capa_foco_faixa
  check (capa_foco_x between 0 and 100 and capa_foco_y between 0 and 100);
