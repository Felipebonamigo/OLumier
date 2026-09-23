/**
 * Busca por rosto — as constantes e a comparação.
 *
 * Sem `server-only` de propósito: a mesma comparação roda no servidor (a busca
 * do convidado) e nos testes, e as constantes são lidas pelo navegador ao
 * medir. Nada aqui toca banco nem rede.
 *
 * ── TODO NÚMERO ABAIXO FOI MEDIDO, NÃO CHUTADO ─────────────────────────────
 *
 * Em 03/09/2026, na bancada `/spike-rostos` (ver o cabeçalho de
 * `src/app/spike-rostos/page.tsx` para as tabelas completas):
 *
 *   - Encolhendo a MESMA foto, a distância do rosto para ele mesmo vai de
 *     0,127 (95 px) a 0,592 (20 px). Ao mesmo tempo, a distância entre pessoas
 *     DIFERENTES encolhe. As curvas se cruzam entre 40 e 50 px.
 *
 *   - Em 7 fotos de 7 casamentos diferentes, 14 pares de estranhos ficaram
 *     abaixo de 0,6 — todos com rosto de até 38 px. O pior: uma mulher de
 *     cabelo longo e um homem barbudo, a 0,241. Nenhum par com os dois rostos
 *     acima de 59 px caiu abaixo de 0,6.
 *
 *   - Espelhar o rosto custa 0,226 a 0,550 de distância. Mais que rotação de
 *     8° (até 0,282), JPEG a 40% (até 0,230) e mudança de luz (até 0,209).
 */

/** Quantos números o face-api devolve por rosto. */
export const TAMANHO_VETOR = 128;

/**
 * Abaixo desta distância, é a mesma pessoa.
 *
 * O face-api sugere 0,6. Com 0,6, catorze pares de estranhos casaram. Com os
 * rostos acima do piso, o pior par legítimo medido ficou em 0,62 e o melhor
 * par de estranhos em 0,67 — margem fina demais para uma régua que decide se
 * o convidado recebe as fotos de um desconhecido. 0,5 fica no meio da folga
 * que sobra depois do piso, e a tela pede confirmação em vez de decidir sozinha.
 */
export const LIMIAR_MESMA_PESSOA = 0.5;

/**
 * Largura mínima do rosto, em pixels, NA IMAGEM EM QUE FOI MEDIDO.
 *
 * Abaixo de ~50 px os vetores de pessoas diferentes colidem. 60 deixa folga. É
 * por isso que a medição acontece no ORIGINAL do fotógrafo, não na prévia de
 * 2048: um rosto de 23 px na prévia tem ~67 px num original de 6000 — passa.
 */
export const PISO_ROSTO_PX = 60;

/**
 * Teto de rostos por foto. Foto de plenária tem 200 cabeças; guardar todas
 * seria 100 KB de vetor para uma foto em que ninguém se acha mesmo. Os maiores
 * ficam — são os que o piso já favorece.
 */
export const MAX_ROSTOS_POR_FOTO = 30;

/**
 * Quantos vetores a busca aceita de uma vez: a selfie e o espelho dela.
 * A câmera frontal grava espelhado, e o espelho sozinho custa até 0,550.
 */
export const MAX_VETORES_NA_BUSCA = 2;

export interface RostoGuardado {
  mediaId: string;
  vetor: ArrayLike<number>;
}

export interface FotoEncontrada {
  mediaId: string;
  /** Menor distância entre os vetores da busca e os rostos daquela foto. */
  distancia: number;
}

/** Distância euclidiana — a régua do face-api. */
export function distancia(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/** 128 números finitos. Tudo o que não for isso é recusado antes de tocar banco. */
export function vetorValido(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length === TAMANHO_VETOR &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/**
 * As fotos em que a pessoa aparece, da mais parecida para a menos.
 *
 * Uma foto com dois rostos aparece uma vez, pela menor distância. Vários
 * vetores de busca (selfie + espelho) contam como "basta um casar".
 */
export function casar(
  vetoresBusca: ArrayLike<number>[],
  rostos: RostoGuardado[],
  limiar = LIMIAR_MESMA_PESSOA,
): FotoEncontrada[] {
  const melhorPorFoto = new Map<string, number>();

  for (const r of rostos) {
    let menor = Infinity;
    for (const v of vetoresBusca) {
      const d = distancia(v, r.vetor);
      if (d < menor) menor = d;
    }
    if (menor >= limiar) continue;
    const atual = melhorPorFoto.get(r.mediaId);
    if (atual === undefined || menor < atual) melhorPorFoto.set(r.mediaId, menor);
  }

  return [...melhorPorFoto]
    .map(([mediaId, d]) => ({ mediaId, distancia: d }))
    .sort((a, b) => a.distancia - b.distancia);
}
