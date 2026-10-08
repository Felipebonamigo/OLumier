-- ============================================================================
--  A VERSÃO LEVE DO VÍDEO — a cópia que o cliente assiste
-- ============================================================================
--
--  08/10/2026, galeria do Mirna e Diogo: "os vídeos abrem e nem executam".
--  Eram 32 `.MOV` do iPhone em HEVC, de 13 a 54 Mbps, tocados direto do
--  original. HEVC não abre em todo navegador, e 54 Mbps não passam num 4G.
--
--  Esta coluna aponta para uma cópia H.264, até 1080p, ~5 Mbps, com o índice
--  na frente, que o navegador do FOTÓGRAFO gera no envio (`lib/versao-leve.ts`)
--  e que mora no R2, como toda derivada. O original segue intacto para baixar.
--
--  Coluna própria, e não `chave_preview`, de propósito: `chave_preview` é a
--  IMAGEM grande da foto, e capa pública, vitrine, cartão de link e e-mail a
--  leem como imagem. Um MP4 ali viraria capa quebrada.
--
--  Nula é o normal — vídeo que já toca bem não ganha cópia, e vídeo enviado
--  antes desta data só ganha se o fotógrafo preparar pelo painel. Nula, o
--  player toca o original, como sempre.

alter table medias
  add column if not exists chave_reproducao text;
