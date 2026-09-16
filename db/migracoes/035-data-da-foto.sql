-- QUANDO A FOTO FOI TIRADA — a data que a câmera gravou, não a do envio.
--
-- ── DE ONDE VEIO ───────────────────────────────────────────────────────────
--
-- Felipe, 16/09/2026: "adicionar um sistema de controle das fotos em cada
-- capítulo. Para além de ter a funcionalidade de mover de um capítulo pro
-- outro, poder organizar por ordem de upload/adição // por ordem cronológica //
-- por nome A-Z // por nome Z-A".
--
-- Três dessas quatro ordens já eram possíveis com o que a tabela tem:
-- `criado_em` é a ordem de envio e `nome_original` dá o A-Z e o Z-A. A
-- cronológica não — e é justamente a que o casamento precisa.
--
-- ── POR QUE `criado_em` NÃO SERVE DE CRONOLÓGICA ───────────────────────────
--
-- Ele é a hora em que a LINHA nasceu, ou seja, a hora do upload. Num casamento
-- com dois fotógrafos, as duas pastas sobem uma depois da outra: a ordem de
-- envio põe o segundo fotógrafo inteiro depois do primeiro, e a festa fica
-- depois da cerimônia dele mesmo. O nome do arquivo também não resolve, porque
-- cada câmera numera a sua própria sequência — `DSC_0001` das duas.
--
-- A única coisa que sabe a ordem real da festa é o relógio da câmera, e ele
-- está no EXIF: `DateTimeOriginal`.
--
-- ── POR QUE A COLUNA ACEITA NULO, E VAI CONTINUAR ACEITANDO ────────────────
--
-- Vídeo não tem EXIF de foto. PNG e WebP normalmente não trazem a data. Foto
-- editada e exportada sem metadados também não. E, sobretudo: TODA foto
-- enviada antes desta migração não tem como ganhar a data depois — o original
-- está no bucket, e baixá-lo de volta para ler o cabeçalho custaria banda do
-- B2 por arquivo.
--
-- Por isso a ordenação cronológica cai em `criado_em` quando a data falta, e a
-- tela diz isso. Uma ordem que mente em silêncio é pior que uma ordem que
-- avisa onde não sabe.
--
-- Sem índice de propósito: a coluna é lida para ordenar as fotos de UM
-- capítulo, algumas centenas de linhas que a consulta já traz por
-- `galeria_id`. Um índice aqui seria escrita mais cara em todo upload para
-- acelerar uma operação que o fotógrafo faz uma vez por entrega.

alter table medias add column if not exists tirada_em timestamptz;

comment on column medias.tirada_em is
  'DateTimeOriginal do EXIF, lido no navegador durante o envio. Nulo quando o arquivo não traz (vídeo, PNG, foto exportada sem metadados) e em tudo que subiu antes da migração 035.';
