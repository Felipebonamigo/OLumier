/**
 * QUANTAS FOTOS A GRADE DESENHA DE CADA VEZ.
 *
 * ── A QUEIXA (26/09/2026) ─────────────────────────────────────────────────
 *
 * "A galeria parece lenta para abrir." Medido numa bancada com galerias de
 * 100, 300, 600 e 2100 fotos, num celular simulado (CPU 4× mais lenta, 4G):
 *
 *      fotos   documento   nós no DOM   pronta (DCL)   thread travada
 *       100     0,34 MB       1.113        0,78 s          0,54 s
 *       300     0,96 MB       3.113        1,57 s          0,91 s
 *       600     1,88 MB       6.113        2,15 s          1,69 s
 *
 * Tudo cresce em linha reta com o número de fotos DESENHADAS na primeira
 * pintura — e nenhuma delas além da primeira dúzia está na tela. A rede não é
 * o problema (os 1,88 MB viram 117 KB comprimidos); o problema é o celular
 * montar, estilizar e hidratar seis mil nós antes de responder ao primeiro
 * toque.
 *
 * ── O QUE MUDA, E O QUE NÃO MUDA ──────────────────────────────────────────
 *
 * Os DADOS continuam chegando inteiros, como antes: `itens` e `capitulos` são
 * a galeria toda (ou a fatia de `config/fatia-galeria.ts`, nas enormes). O
 * filtro de favoritas, o slideshow, o visualizador, o menu de capítulos e o
 * "baixar" continuam enxergando todas as fotos — nada disso depende do DOM.
 *
 * O que passa a ser por partes é só o DESENHO: a primeira leva sai no
 * documento, e as seguintes entram quando a rolagem se aproxima do fim do que
 * já foi desenhado. Sem ida ao servidor — as fotos já estão na memória —, é
 * só o React acrescentar cards.
 *
 * É a mesma ideia da rolagem infinita de 16/09/2026 (`api/g/[id]/mais`), um
 * degrau antes: aquela busca na rede o que não coube no documento; esta
 * desenha o que já está no documento, mas ninguém ainda rolou até ver.
 */

/**
 * Quantos cards saem desenhados no documento.
 *
 * Tem de encher a primeira tela no pior caso — monitor largo, grade densa,
 * capa curta — com folga para a rolagem começar sem esperar. Oito colunas
 * por seis fileiras são 48; 60 fecha fileiras inteiras em 2, 3, 4, 5 e 6
 * colunas, então a última fileira desenhada não sai pela metade nas grades
 * mais comuns.
 */
export const PRIMEIRA_LEVA = 60;

/** Quantos cards entram a cada vez que a rolagem se aproxima do fim. */
export const LEVA = 120;

export interface CapituloParaDesenhar {
  id: string;
  indices: number[];
}

export interface Desenho<C> {
  /**
   * Os capítulos com alguma foto visível, na ordem da página, cada um só com
   * as fotos desenhadas. O que ainda não chegou ao desenho vem com `indices`
   * vazio — ver o porquê em `recortarParaDesenhar`.
   */
  capitulos: (C & { indices: number[] })[];
  /** Quantas fotos visíveis existem, somando todos os capítulos. */
  visiveis: number;
  /** Ainda há foto visível fora do desenho? É o que liga a sentinela. */
  falta: boolean;
}

/**
 * Corta os capítulos para caber em `limite` cards, na ordem da página.
 *
 * O limite conta fotos VISÍVEIS, não posições em `itens`: com "só as
 * favoritas" ligado, as marcadas podem estar todas na foto 400, e um corte
 * por posição desenharia uma tela vazia embaixo de "Mostrando 12 favoritas".
 *
 * Capítulo sem nenhuma foto visível some, como sempre sumiu — um título
 * sozinho na tela faria parecer que as fotos se perderam.
 *
 * Capítulo com fotos visíveis mas fora do limite CONTINUA na lista, com
 * `indices` vazio, e isso é pelo menu de capítulos: o marcador de "qual
 * capítulo a pessoa está vendo" (`menus-da-galeria.tsx`) procura as seções
 * pelo id UMA vez, quando a lista de capítulos muda — e não quando o desenho
 * cresce. Se a seção só nascesse quando a rolagem chegasse, ele nunca a
 * enxergaria. Com ela já no lugar (vazia e escondida), é o mesmo nó do DOM
 * que ganha as fotos depois, e o observador que já a vigiava vê a mudança.
 */
export function recortarParaDesenhar<C extends CapituloParaDesenhar>(
  capitulos: readonly C[],
  visivel: (indice: number) => boolean,
  limite: number,
): Desenho<C> {
  const saida: (C & { indices: number[] })[] = [];
  let restante = Math.max(0, Math.floor(limite));
  let visiveis = 0;

  for (const cap of capitulos) {
    const doCapitulo = cap.indices.filter(visivel);
    if (doCapitulo.length === 0) continue;
    visiveis += doCapitulo.length;
    const desenhadas = doCapitulo.length <= restante ? doCapitulo : doCapitulo.slice(0, restante);
    restante -= desenhadas.length;
    saida.push({ ...cap, indices: desenhadas });
  }

  return { capitulos: saida, visiveis, falta: visiveis > limite };
}
