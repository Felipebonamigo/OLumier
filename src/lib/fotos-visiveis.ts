/**
 * QUAIS FOTOS O CLIENTE ESTÁ VENDO.
 *
 * A galeria tem dois filtros que SOMAM — "só as favoritas" e "só onde eu
 * apareço" (busca por rosto) — e o resultado é a interseção dos dois.
 *
 * A regra virou função em 10/09/2026, quando o slideshow nasceu. A grade já a
 * tinha escrita à mão dentro do `map` dos capítulos; o slideshow precisava da
 * MESMA resposta para saber por onde passar, e duas cópias de uma regra de
 * filtro é como filtros passam a discordar — o cliente liga "só as favoritas",
 * manda tocar, e recebe o casamento inteiro.
 */

export type FiltrosDaGaleria = {
  /** O botão "ver só as favoritas" está ligado? */
  soFavoritas: boolean;
  /** Ids marcados com coração. Só filtra quando `soFavoritas` está ligado. */
  favoritas: Set<string>;
  /** Ids em que a selfie encontrou a pessoa. `null` = sem essa busca. */
  encontradas: Set<string> | null;
};

export function fotoVisivel(id: string, { soFavoritas, favoritas, encontradas }: FiltrosDaGaleria) {
  if (soFavoritas && !favoritas.has(id)) return false;
  if (encontradas && !encontradas.has(id)) return false;
  return true;
}

/** As posições visíveis, na ordem da página. É por aqui que o slideshow anda. */
export function indicesVisiveis(itens: { id: string }[], filtros: FiltrosDaGaleria): number[] {
  const visiveis: number[] = [];
  for (let i = 0; i < itens.length; i++) {
    if (fotoVisivel(itens[i].id, filtros)) visiveis.push(i);
  }
  return visiveis;
}

/**
 * Quanto cada foto fica na tela no slideshow.
 *
 * Quatro segundos é o ritmo de quem está OLHANDO, não de quem está procurando:
 * dá tempo de ver a foto inteira e não dá tempo de perder a paciência. Quem
 * quiser mais rápido tem as setas, que continuam valendo e param o automático.
 */
export const SEGUNDOS_POR_FOTO = 4;
