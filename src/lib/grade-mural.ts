/**
 * A matemática do mural — quantas colunas cabem, quem vai em qual, e quem
 * merece o dobro de largura.
 *
 * Módulo separado do componente por dois motivos. O primeiro é poder testar:
 * `scripts/testar-grade-mural.mjs` importa isto direto, sem navegador, e a
 * distribuição das fotos é regra de produto — regra de produto se testa. O
 * segundo é que estas funções não são de React: são aritmética, e ficam
 * legíveis longe do JSX.
 *
 * ── O DEFEITO QUE ISTO CONSERTA (04/09/2026) ───────────────────────────────
 *
 * A grade "colunas" era `column-width` do CSS, e multi-column preenche uma
 * coluna INTEIRA antes de começar a seguinte. Com 30 fotos em 3 colunas, a
 * foto 21 ia para o topo da terceira coluna — o sócio descreveu como "fotos do
 * fim aparecerem bem em cima", e é literalmente isso.
 *
 * Não há como consertar isso só com CSS: quem decide quantas fotos cabem em
 * cada coluna é o próprio motor de multi-column, e ele não expõe esse número.
 * Por isso a largura é MEDIDA no navegador e a distribuição é feita à mão.
 */

/** A partir daqui a foto conta como deitada — 4:3 (1,33) entra, quadrada não. */
export const PROPORCAO_DEITADA = 1.3;

export const ehDeitada = (proporcao: number): boolean => proporcao >= PROPORCAO_DEITADA;

/**
 * Quantas colunas de `larguraAlvo` cabem em `larguraDisponivel`.
 *
 * Nunca devolve zero: antes de a medição acontecer a largura é 0, e zero
 * colunas não desenha foto nenhuma. Uma coluna é o que o celular recebe de
 * qualquer forma, então é o palpite seguro para o primeiro quadro.
 */
export function colunasQueCabem(
  larguraDisponivel: number,
  larguraAlvo: number,
  gap: number,
): number {
  if (!Number.isFinite(larguraDisponivel) || larguraDisponivel <= 0) return 1;
  return Math.max(1, Math.floor((larguraDisponivel + gap) / (larguraAlvo + gap)));
}

/**
 * Reparte os índices entre as colunas na ordem de LEITURA.
 *
 * A foto `i` vai para a coluna `i % colunas`. Com 3 colunas: 0,1,2 na primeira
 * fileira; 3,4,5 na segunda. O topo das colunas é 0,1,2 — que é o que a pessoa
 * espera ver primeiro, da esquerda para a direita.
 *
 * As alturas das colunas ficam desiguais, e isso é o mural: as fotos têm
 * proporções diferentes e ninguém quer que sejam cortadas. O que não pode
 * acontecer — e era o que acontecia — é a ORDEM se perder.
 */
export function distribuirEmColunas(quantidade: number, colunas: number): number[][] {
  const n = Math.max(1, Math.floor(colunas));
  /* Colunas a mais que fotos ficariam vazias e ainda assim ocupariam largura,
   * espremendo as que têm foto. Com poucas fotos, menos colunas. */
  const usadas = Math.max(1, Math.min(n, quantidade));
  const saida: number[][] = Array.from({ length: usadas }, () => []);
  for (let i = 0; i < quantidade; i++) saida[i % usadas].push(i);
  return saida;
}

/**
 * Quantas colunas o item ocupa no modo panorama.
 *
 * A foto deitada ganha duas — é o "mais valorizada" do pedido. Só que quando
 * cabe UMA coluna na tela, ninguém ocupa duas: o item estouraria a largura do
 * celular, e o CSS não tem como recusar isso sozinho (`grid-column: span 2`
 * cria uma coluna implícita fora do container).
 */
export function colunasDoItem(proporcao: number, colunasDisponiveis: number): number {
  return colunasDisponiveis >= 2 && ehDeitada(proporcao) ? 2 : 1;
}

/**
 * Quantas colunas a grade usa — a largura-alvo, com piso e teto.
 *
 * `colunasQueCabem` responde "quantas cabem"; esta responde "quantas devem".
 * A diferença é a tela real: num celular cabe uma foto arejada, e uma foto por
 * vez não é galeria, é apresentação de slides. Num monitor de 1600 cabem oito
 * compactas, e oito é parede.
 *
 * O piso vence o teto quando os dois brigam (piso 3, teto 2 num container
 * minúsculo): melhor apertado do que abaixo do mínimo que a densidade promete.
 */
export function colunasDaGrade(
  larguraDisponivel: number,
  larguraAlvo: number,
  gap: number,
  minColunas: number,
  maxColunas: number,
): number {
  const cabem = colunasQueCabem(larguraDisponivel, larguraAlvo, gap);
  return Math.max(minColunas, Math.min(maxColunas, cabem));
}
