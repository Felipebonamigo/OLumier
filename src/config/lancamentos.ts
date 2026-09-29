/**
 * O QUE A COMUNICAÇÃO PÚBLICA PODE ANUNCIAR — um interruptor por recurso.
 *
 * ── POR QUE ISTO EXISTE (26/09/2026) ──────────────────────────────────────
 *
 * A estratégia de marca e o briefing da nova home pedem a mesma coisa com
 * palavras diferentes: recurso que EXISTE no código não é, só por isso,
 * recurso que se promete na página de vendas. Entre "existe" e "anuncia"
 * mora a validação — com entrega real, no ambiente real.
 *
 * Cada interruptor aqui separa essas duas coisas para um recurso. Desligado,
 * o recurso continua funcionando para quem já usa; o que some é a PROMESSA
 * (home, FAQ, montador de planos). Ligar é uma linha, e é decisão do Felipe
 * depois de validar — não de quem está mexendo no texto.
 *
 * Ver `docs/home-leitura-critica.md`, conflitos C1 e C2.
 */

/*
 * VÍDEO NA ENTREGA.
 *
 * O player, o envio em partes para filme grande e a regra "filme é só espaço"
 * existem e têm teste (`testar-multipart`, `testar-planos`). O que não há
 * registro é de entrega real de filme validada. Até haver, a home não fala de
 * filme, de 4K nem de filmmakers, e o montador de planos esconde a escolha
 * Foto/Filme — quem filma escolhe isso no cadastro, como sempre.
 */
export const VIDEO_LIBERADO = false;

/*
 * DOMÍNIO PRÓPRIO DO ESTÚDIO (galeria.seuestudio.com.br).
 *
 * `docs/dominio-proprio.md` diz "CONSTRUÍDO, menos o Caddy": sem o bloco do
 * Caddy o domínio do estúdio não ganha certificado, e o ensaio com domínio
 * real não foi feito. A home antiga já anunciava. Desligado, a página mostra
 * só o subdomínio — que está no ar para todo estúdio — e o FAQ diz a verdade.
 */
export const DOMINIO_PROPRIO_LIBERADO = false;
