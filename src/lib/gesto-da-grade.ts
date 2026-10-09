/**
 * SEGUROU E ANDOU MARCA; ANDOU LOGO REORDENA.
 *
 * ── DE ONDE VEIO (09/10/2026) ─────────────────────────────────────────────
 *
 * Juan, repassando: "quando eu to ajustando a ordem das fotos, eu conseguia
 * clicar no lado esquerdo do mouse e ir subindo e selecionar tudo sem precisar
 * selecionar 1 por 1 a mão". E, perguntado do gesto: "clicar em um, e
 * arrastar, seja para cima e para baixo, assim como no celular também".
 *
 * ── O CONFLITO ────────────────────────────────────────────────────────────
 *
 * Apertar numa foto e arrastar já faz uma coisa na grade: REORDENAR. A mesma
 * ação não pode ter dois resultados sem um jeito de distinguir — e o jeito que
 * todo mundo já aprendeu no celular é a ESPERA: segurou e andou, marca; andou
 * logo, arrasta.
 *
 * ── POR QUE DOIS NÚMEROS, E NÃO UM ────────────────────────────────────────
 *
 * Só o relógio não basta. Segurar parado, no mundo real, anda alguns pixels —
 * mais com o dedo no vidro que com o mouse. Sem a folga, a marcação quase
 * nunca começaria no celular, que é justamente onde o gesto é esperado.
 *
 * E só a distância também não basta: quem arrasta uma foto para o começo da
 * galeria anda MUITO, e isso é reordenar, não marcar.
 */

/** Quanto segurar parado antes de a marcação começar. */
export const ESPERA_PARA_MARCAR_MS = 350;

/** Quanto o ponteiro pode andar nesse meio-tempo e ainda contar como parado. */
export const TOLERANCIA_DO_DEDO_PX = 8;

export interface Gesto {
  /** Desde que o ponteiro encostou. */
  ms: number;
  /** Quanto ele andou desde ali, em linha reta. */
  px: number;
}

/**
 * Este gesto já virou marcação?
 *
 * Número estranho devolve `false` de propósito: o relógio e a geometria vêm de
 * eventos do navegador, e na dúvida o gesto é o que a grade já fazia antes —
 * reordenar. Um "talvez" que vira marcação mexeria na seleção de quem só
 * queria arrastar.
 */
export function viraMarcacao({ ms, px }: Gesto): boolean {
  if (!Number.isFinite(ms) || !Number.isFinite(px)) return false;
  if (ms < 0 || px < 0) return false;
  return ms >= ESPERA_PARA_MARCAR_MS && px <= TOLERANCIA_DO_DEDO_PX;
}
