/**
 * ESCOLHER A CENA DA CAPA DE UM FILME (08/10/2026).
 *
 * Juan, vendo a aba Vídeo com 24 filmes "sem capa": "existe a opção de a pessoa
 * selecionar uma cena do próprio vídeo para ser a capa? Ou um 'selecionar cena
 * aleatória do vídeo'". Até aqui o quadro saía do segundo 1 (ou de 25% e 50%
 * quando o primeiro vinha preto), sem o fotógrafo opinar.
 *
 * Sem `server-only`: a janela da cena é do cliente.
 */

/**
 * A "cena aleatória" nunca cai nas pontas. O começo e o fim de um filme de
 * casamento são letreiro, tela preta e créditos — sortear ali devolveria a
 * capa que ninguém quer, que é o problema que o botão existe para resolver.
 */
export const MARGEM_DO_SORTEIO = 0.05;

/**
 * Um número de 0 (inclusive) a 1 (exclusive). `crypto` e não o gerador comum:
 * o projeto não usa o gerador fraco em lugar nenhum (`testar-defaults-inseguros`
 * varre por ele), e aqui custa uma linha igual.
 */
function sorteDeVerdade(): number {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return n[0] / 0x100000000;
}

/** Um segundo do filme que vale como capa. `sorte` é um número de 0 a 1. */
export function sortearCena(duracao: number, sorte: number = sorteDeVerdade()): number {
  if (!Number.isFinite(duracao) || duracao <= 0) return 0;
  const s = Math.min(Math.max(sorte, 0), 1);
  return duracao * (MARGEM_DO_SORTEIO + s * (1 - 2 * MARGEM_DO_SORTEIO));
}

/**
 * Prende um instante dentro do filme. Os botões de "−1 s" e "+1 s" e o teclado
 * chegam aqui, e o `currentTime` do navegador aceita passar do fim sem avisar —
 * o quadro que sairia seria o último, que costuma ser preto.
 */
export function limitarCena(segundos: number, duracao: number): number {
  if (!Number.isFinite(segundos)) return 0;
  const fim = Number.isFinite(duracao) && duracao > 0 ? duracao : segundos;
  return Math.min(Math.max(0, segundos), fim);
}

/** O primeiro quadro que a janela mostra: 10% adentro, onde já há cena. */
export function cenaInicial(duracao: number): number {
  return limitarCena(duracao * 0.1, duracao);
}
