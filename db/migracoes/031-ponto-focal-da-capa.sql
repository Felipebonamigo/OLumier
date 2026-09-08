-- PONTO FOCAL DA CAPA: onde a foto deve ser cortada.
--
-- ── DE ONDE VEIO ───────────────────────────────────────────────────────────
--
-- Juan, 08/09/2026, com o print da capa dividida: "não consigo escolher onde
-- fica o ponto focal, eu queria que aparecesse mais o corpo do noivo, mas o
-- enquadramento foi automático". Na foto dele o noivo estava encostado na borda
-- de baixo, quase saindo.
--
-- O "automático" é o `object-cover` do CSS: ele preenche a caixa e descarta o
-- excedente pelo CENTRO. Numa capa que é uma faixa larga e numa foto que é um
-- retrato 2:3, isso joga fora a metade de cima e a de baixo — e o assunto da
-- foto quase nunca está exatamente no meio. Não havia defeito: havia uma
-- escolha que só o CSS estava fazendo.
--
-- ── POR QUE COLUNA, E NÃO DENTRO DE `aparencia` ───────────────────────────
--
-- O foco pertence à FOTO escolhida, não ao tema. Trocar de preset não pode
-- mexer no enquadramento, e trocar a foto TEM de zerá-lo — um foco calibrado
-- para a foto A não quer dizer nada na foto B. Essa é exatamente a vida da
-- própria escolha de capa, que já mora em `capa_media_id` / `capa_chave` e já
-- vale na hora, fora do rascunho de aparência. Guardá-lo em `aparencia` o
-- prenderia ao "Publicar aparência" e o faria sobreviver à troca da foto.
--
-- ── POR QUE DOIS SMALLINT, E NÃO UM TEXTO "30% 78%" ───────────────────────
--
-- Porque o valor vai para dentro de um `style` que a galeria do cliente
-- renderiza. Texto livre ali é CSS escolhido por quem grava; dois inteiros com
-- faixa conferida pelo banco não têm como virar outra coisa. É a mesma regra
-- das cores próprias (`COR_HEX` em config/aparencia.ts), pelo mesmo motivo.
--
-- 50/50 é o centro — exatamente o que o `object-cover` já fazia sozinho. Toda
-- galeria existente nasce com o enquadramento que ela já tem hoje, e nenhuma
-- entrega muda de cara por causa desta migração.

alter table galerias
  add column if not exists capa_foco_x smallint not null default 50,
  add column if not exists capa_foco_y smallint not null default 50;

alter table galerias
  drop constraint if exists galerias_capa_foco_faixa;

alter table galerias
  add constraint galerias_capa_foco_faixa
  check (capa_foco_x between 0 and 100 and capa_foco_y between 0 and 100);
