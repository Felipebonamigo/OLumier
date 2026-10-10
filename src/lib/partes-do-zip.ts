/**
 * A GALERIA GRANDE EM PARTES (10/10/2026).
 *
 * Um ZIP de 20 GB sai numa conexão só. Do servidor de ZIP na Alemanha até o
 * Brasil, uma conexão rende bem menos que várias juntas — o requisito de
 * "blocos paralelos" de `docs/arquitetura-armazenamento.md` — e uma queda no
 * fim de uma conexão de horas é o pior momento possível. Em partes de até
 * 4 GB, o navegador baixa várias ao mesmo tempo, e uma queda perde uma parte.
 *
 * Cada parte é um ZIP INTEIRO, que abre sozinho — não o ZIP fatiado do
 * WinRAR (`.z01`), que só abre com todas as partes e com o programa certo.
 * As pastas de capítulo continuam dentro de cada parte: extrair as quatro no
 * mesmo lugar junta tudo de volta.
 *
 * ── POR QUE 4 GB ──────────────────────────────────────────────────────────
 *
 * É abaixo do teto de arquivo do FAT32 (4 GiB), o formato de pendrive e
 * cartão que muita gente usa para levar as fotos à gráfica. Cabe também com
 * folga no disco de quem baixa, e dá partes em número que ainda se clica.
 *
 * ── A DIVISÃO É SEMPRE A MESMA ────────────────────────────────────────────
 *
 * Contígua, na ordem do ZIP inteiro, e decidida só pelo tamanho de cada
 * arquivo: o menu mostra "parte 2 de 4" e o clique, minutos depois, recalcula
 * a mesma divisão. Os nomes dentro do ZIP saem do ZIP inteiro
 * (`entradasDoZip`) ANTES de dividir, então a segunda "DSC_0001.jpg" se chama
 * "DSC_0001 (2).jpg" em qualquer parte em que cair — extrair tudo junto não
 * sobrescreve nada.
 *
 * Pura: `scripts/testar-partes-do-zip.mjs`.
 */

/** O teto de cada parte, em bytes do conteúdo. */
export const LIMITE_DA_PARTE = 4 * 1000 ** 3;

/**
 * Divide em partes contíguas de até `limite`. Um arquivo maior que o limite
 * (um filme) vai sozinho numa parte — ele não pode ser cortado ao meio.
 */
export function dividirEmPartes<T extends { tamanho: number }>(arquivos: T[], limite = LIMITE_DA_PARTE): T[][] {
  const partes: T[][] = [];
  let atual: T[] = [];
  let soma = 0;
  for (const a of arquivos) {
    if (atual.length > 0 && soma + a.tamanho > limite) {
      partes.push(atual);
      atual = [];
      soma = 0;
    }
    atual.push(a);
    soma += a.tamanho;
  }
  if (atual.length > 0) partes.push(atual);
  return partes;
}

/** "Casamento Ana e Pedro.zip" → "Casamento Ana e Pedro - parte 2 de 4.zip". */
export function nomeDaParte(nomeDoZip: string, numero: number, de: number): string {
  const base = nomeDoZip.replace(/\.zip$/i, "");
  return `${base} - parte ${numero} de ${de}.zip`;
}

/** A parte pedida no endereço (`?parte=2`), ou `null` sem pedido ou com lixo. */
export function lerParte(bruto: string | null): number | null {
  if (!bruto || !/^\d{1,4}$/.test(bruto)) return null;
  const n = Number(bruto);
  return n >= 1 ? n : null;
}
