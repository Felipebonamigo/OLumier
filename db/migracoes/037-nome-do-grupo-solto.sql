-- O NOME DO GRUPO DAS FOTOS SEM CAPÍTULO: quem escolhe é o fotógrafo.
--
-- ── DE ONDE VEIO ───────────────────────────────────────────────────────────
--
-- Juan, 18/09/2026, com a foto da barra de capítulos da galeria dele:
--
--   "aqui fica aparecendo 'outras fotos', pelo que eu vi é todas as fotos
--    juntas, não tem como trocar pra esse nome. Tipo galeria completa ou algo
--    assim. Ou eu não sei se foi eu que fiz algo de errado kkkk, mas não criei
--    nenhuma pasta com esse nome."
--
-- Ele não fez nada de errado: "Outras fotos" é um nome que a PÁGINA inventa,
-- em 04/09/2026, para as fotos que não estão em capítulo nenhum. Antes disso o
-- grupo entrava sem nome e desenhava uma pastilha vazia no meio das outras —
-- um botão sem texto. O nome resolveu a pastilha vazia e criou este defeito:
-- o fotógrafo vê, na galeria que ele assina, uma pasta que ele não criou e
-- não consegue renomear. Os capítulos dele têm nome porque ele os escreveu;
-- este tem o nosso.
--
-- ── POR QUE UMA COLUNA, E NÃO UMA LINHA EM `secoes` ───────────────────────
--
-- A tentação é transformar o grupo num capítulo de verdade na hora em que
-- alguém o renomeia. Ela quebraria o que o grupo É: a ausência de capítulo.
-- Uma linha em `secoes` precisaria de ordem, de apagar, de mover, e as fotos
-- que chegassem soltas DEPOIS não entrariam nela sozinhas — o fotógrafo teria
-- de mover cada lote à mão, que é exatamente o trabalho que o grupo evita.
--
-- A coluna guarda só o NOME. O grupo continua sendo "o que sobrou", calculado
-- a cada carregamento, e passa a se chamar o que o dono da galeria quiser.
--
-- ── NULO É O ESTADO NORMAL ────────────────────────────────────────────────
--
-- Nulo (e vazio) quer dizer "Outras fotos", que é o que toda galeria já mostra
-- hoje — `GRUPO_SEM_CAPITULO`, em `lib/nome-de-arquivo.ts`. Nenhuma galeria
-- muda de texto por causa desta migração; ela só passa a aceitar outro.
--
-- ── É POR GALERIA, E NÃO POR ESTÚDIO ──────────────────────────────────────
--
-- Diferente do padrão de design (036), que é a identidade do estúdio e se
-- repete em toda entrega. Este nome descreve o CONTEÚDO de uma galeria: num
-- casamento as soltas podem ser "Galeria completa", e no ensaio da semana
-- seguinte, "Extras". Um valor por estúdio acertaria as duas com o mesmo
-- texto.

alter table galerias add column if not exists grupo_solto text;

comment on column galerias.grupo_solto is
  'Como se chama, na galeria do cliente, o grupo das fotos sem capítulo. Nulo ou vazio = "Outras fotos".';
