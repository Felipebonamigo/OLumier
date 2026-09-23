-- A fonte própria do estúdio.
--
-- Pedido do dono em 31/08/2026: o fotógrafo tem a tipografia da marca dele em
-- arquivo, e até aqui só podia escolher entre as 21 que nós carregamos. A fonte
-- passa a ser um ativo do ESTÚDIO, como a logo — sobe uma vez em Conta e vira
-- mais uma opção no seletor de tipografia de qualquer galeria.
--
-- Duas colunas, e as duas nulas por padrão: quem não enviar nada continua
-- exatamente como está, e a opção nem aparece na tela.
--
--   fonte_chave — objeto no bucket, no mesmo formato de `logo_chave`
--   fonte_nome  — como a pessoa reconhece a fonte no seletor. Vem do nome do
--                 arquivo enviado, porque ler o nome de dentro da fonte exigiria
--                 um parser de tabela `name` para ganhar pouco: quem enviou
--                 sabe o que enviou, e pode renomear o arquivo se quiser.
--
-- Aditiva e reversível: `drop column` desfaz sem tocar em linha nenhuma.

alter table tenants
  add column if not exists fonte_chave text,
  add column if not exists fonte_nome  text;
