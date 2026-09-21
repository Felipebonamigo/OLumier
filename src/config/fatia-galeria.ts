/**
 * Quanto da galeria cabe num documento só.
 *
 * ── O DEFEITO QUE ISTO EXISTE PARA CORRIGIR (11/09/2026) ──────────────────
 *
 * A galeria "Casamento Ana & Kaio" tem 2108 fotos, e no iPhone da Carol o
 * Safari mostrava "Um problema ocorreu repetidamente" — a tela de quando a aba
 * estoura de memória e o navegador desiste de recarregar.
 *
 * Não era a âncora de capítulo nem o `?previa=1`. Era o tamanho, e ele é
 * LINEAR, medido em produção nas galerias dela:
 *
 *     97 fotos  → 0,31 MB de HTML
 *    220 fotos  → 0,69 MB
 *   2108 fotos  → 6,35 MB   ← o Safari morre aqui
 *
 * ~3,2 KB de documento por foto, sempre. Desses, 37% são as URLs assinadas
 * (588 caracteres cada, e cada foto aparece DUAS vezes: no `<img>` e nos dados
 * de hidratação). O resto é o React de 2108 itens. Somem-se 2110 `<img>` no
 * DOM e a conta fecha contra o limite de memória de uma aba no iPhone.
 *
 * ── POR QUE O CORTE É NO SERVIDOR ─────────────────────────────────────────
 *
 * A saída óbvia — desenhar tudo e esconder no cliente — não tira um byte do
 * documento, que é justamente o que estoura. O servidor precisa MANDAR menos.
 *
 * ── E POR QUE SÓ AS GRANDES MUDAM ─────────────────────────────────────────
 *
 * Abaixo do teto não há defeito a corrigir: a galeria de 97 fotos continua
 * inteira numa tela, com as âncoras de capítulo funcionando como sempre.
 * Mudar o comportamento dela seria pagar com a experiência de todo mundo uma
 * conta que só as galerias enormes devem.
 */

/**
 * O teto, em fotos.
 *
 * 600 × 3,2 KB ≈ 1,9 MB de documento — cabe com folga em qualquer celular que
 * abra a internet hoje, e ainda é mais que o dobro da maior galeria que a
 * Carol tinha entregue antes desta. Não é um número redondo por acaso: é o
 * maior valor que mantém o documento abaixo de 2 MB com a medida real de
 * 3,2 KB por foto.
 */
export const FOTOS_POR_TELA = 600;

/**
 * Quantas fotos a busca por rosto pode pedir de uma vez, pelo endereço.
 *
 * As encontradas viajam como lista de ids na URL — é o que faz o resultado da
 * selfie não depender do capítulo que por acaso está aberto. Um id são 37
 * caracteres; 300 deles dão ~11 KB de endereço, que servidor e navegador
 * aguentam com folga, e 300 fotos é mais do que qualquer convidado aparece num
 * casamento. Acima disso o corte é silencioso de propósito: o convidado
 * continua vendo a maior parte, e a alternativa seria recusar a busca dele.
 */
export const TETO_DE_ESCOLHIDAS = 300;

export interface Fatia<T> {
  /** O que vai para o documento. */
  itens: T[];
  /** Quantas fotos a galeria tem no total. */
  total: number;
  /** A galeria passou do teto e está sendo servida em pedaços? */
  fatiada: boolean;
  /** Quantas fotos do capítulo ficaram DEPOIS desta tela. */
  restantes: number;
}

/**
 * Corta a lista de fotos para caber num documento.
 *
 * `secaoId` escolhe o capítulo; `null` é "o começo da galeria" e `undefined`
 * quer dizer que ninguém escolheu — nos dois casos o corte é pela galeria
 * inteira, na ordem dela. `parte` escolhe qual pedaço de `teto` fotos.
 *
 * Quando a galeria cabe inteira, devolve a lista intacta e `fatiada: false`:
 * é o sinal para a página desenhar exatamente o que desenhava antes.
 */
export function fatiarGaleria<T extends { secao_id?: string | null }>(
  medias: T[],
  secaoId?: string | null,
  teto = FOTOS_POR_TELA,
): Fatia<T> {
  const total = medias.length;

  /* `sem-capitulo` é o id que a página dá ao grupo das fotos que não estão em
     capítulo nenhum. Aqui ele vira o filtro "secao_id nulo". */
  const doCapitulo =
    secaoId === undefined || secaoId === null
      ? medias
      : secaoId === "sem-capitulo"
        ? medias.filter((m) => !m.secao_id)
        : medias.filter((m) => m.secao_id === secaoId);

  /*
   * ── O CAPÍTULO ESCOLHIDO VALE EM QUALQUER TAMANHO (21/09/2026) ──────────
   *
   * Aqui a galeria que cabia inteira saía antes deste filtro: abaixo do teto
   * `?cap=` não fazia nada, e a pastilha era só uma âncora que rolava até a
   * seção. O visitante descia e entrava no capítulo seguinte sem escolher.
   *
   * Juan: "quando chega no fim do capítulo ele está trocando sozinho". Felipe:
   * "poderia encerrar o capítulo 'making of' e ter um botão 'próximo
   * capítulo'".
   *
   * O corte passou a valer sempre; `fatiada` continua dizendo só o que sempre
   * disse — se a galeria passou do teto e o resto vai chegar rolando. São duas
   * perguntas diferentes, e misturá-las é que fazia o comportamento do produto
   * mudar entre 599 e 601 fotos.
   */
  if (total <= teto) return { itens: doCapitulo, total, fatiada: false, restantes: 0 };

  /*
   * O teto vale mesmo DENTRO do capítulo: nada impede um capítulo de 1500.
   *
   * ── E O RESTO CHEGA ROLANDO (16/09/2026) ─────────────────────────────────
   *
   * Até 11/09 o corte era `slice(0, teto)` e mais nada: da 601ª foto em diante
   * não existia tela nenhuma. Veio a paginação, e com ela "parte 3 de 4" — que
   * durou cinco dias. Felipe: "remover paginação dentro do mesmo capítulo, tem
   * apenas que rolar até o final".
   *
   * Esta função voltou a servir UMA tela, que é o que ela sempre fez melhor. O
   * resto é pedido pela rolagem, em `api/g/[id]/mais`, e o corte ali usa este
   * mesmo teto como ponto de partida — por isso `restantes` continua saindo
   * daqui: é ele que diz se ainda há o que buscar.
   */
  return {
    itens: doCapitulo.slice(0, teto),
    total,
    fatiada: true,
    restantes: Math.max(0, doCapitulo.length - teto),
  };
}
