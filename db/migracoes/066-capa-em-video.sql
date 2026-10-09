-- ============================================================================
--  A CAPA DA GALERIA EM VÍDEO (formato Stream)
-- ============================================================================
--
--  Pedido do Juan, 08/10/2026: "adicionar opção de subir capa em VÍDEO no
--  formato Stream". Plataforma de série tem o trailer rodando no fundo da capa;
--  até aqui a capa do Stream era sempre uma imagem parada.
--
--  Não é o filme da galeria tocando de fundo (o original pesa centenas de MB e
--  o 4G de quem recebe o link não carrega isso para só enfeitar a capa): é um
--  CLIPE PRÓPRIO, curto, sem som, que o navegador do fotógrafo prepara antes de
--  subir — ver `components/capa-em-video.tsx`. Uns 3 a 10 MB.
--
--  Mesma forma da `galerias.capa_chave` (migração 029), e pela mesma razão: uma
--  mídia "só capa" exigiria um filtro novo em todo lugar que lista vídeo, e
--  esquecer um deles entrega ao casal um clipe que nunca foi dele.
--
--    · `capa_video_chave`         o clipe (MP4 H.264, sem áudio, em laço);
--    · `capa_video_poster_chave`  o primeiro quadro, em imagem: é o que aparece
--                                 enquanto o clipe carrega, no "reduzir
--                                 movimento" e no modo de economia de dados.
--
--  Nulo é o estado normal — nada muda para quem não enviou nada.
--
--  ── A PARTE QUE NÃO É SQL ────────────────────────────────────────────────
--
--  As duas colunas entram em `chavesConhecidas` (`scripts/varrer-orfaos-regras.mjs`),
--  em `destruirGaleria` e em `apagarGaleriasDaConta`, e o teste
--  `scripts/testar-chaves-conhecidas.mjs` reprova coluna de chave que ninguém
--  nomeou. Foi o que a migração 057 aprendeu.

alter table galerias
  add column if not exists capa_video_chave text,
  add column if not exists capa_video_poster_chave text;
