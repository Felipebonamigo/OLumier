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
 * Reparte os índices entre as colunas, na ordem de LEITURA e pela ALTURA.
 *
 * Cada foto vai para a coluna mais CURTA no momento. Empate vai para a mais à
 * esquerda, então as primeiras fotos ainda ocupam 0, 1, 2 — o topo continua
 * sendo o começo da galeria, lido da esquerda para a direita, que é a regra que
 * este arquivo nasceu para proteger. Dentro de cada coluna os índices seguem
 * crescendo, então a leitura de cima para baixo também se mantém.
 *
 * ── O DEFEITO QUE ISTO CONSERTA (16/09/2026) ──────────────────────────────
 *
 * Era `i % colunas`: a foto 0 na coluna 0, a 1 na 1, a 2 na 2, a 3 na 0 de
 * novo. Repartia a CONTAGEM igualmente e ignorava a altura — e num mural as
 * alturas é que são desiguais, porque as fotos têm proporções diferentes e
 * nenhuma é cortada.
 *
 * Com sorte ruim, uma coluna junta os retratos e a vizinha junta as deitadas:
 * a mesma quantidade de fotos, quase o dobro de altura. Felipe, com a foto do
 * fim da galeria: "ficou estranho, umas partes vazias e outra comprida".
 *
 * Distribuir pela altura não muda a ordem e fecha o buraco: o rodapé das
 * colunas passa a terminar quase junto, e a diferença que resta é, no máximo, a
 * altura de uma foto.
 *
 * @param alturaDe Altura da foto `i` para uma coluna de largura 1 — ou seja,
 *   `1 / proporção`. Sem ela a repartição volta a ser por contagem, que é o
 *   certo quando as alturas não são conhecidas (a grade quadrada, por exemplo,
 *   onde toda foto tem a mesma).
 */
export function distribuirEmColunas(
  quantidade: number,
  colunas: number,
  alturaDe?: (i: number) => number,
): number[][] {
  const n = Math.max(1, Math.floor(colunas));
  /* Colunas a mais que fotos ficariam vazias e ainda assim ocupariam largura,
   * espremendo as que têm foto. Com poucas fotos, menos colunas. */
  const usadas = Math.max(1, Math.min(n, quantidade));
  const saida: number[][] = Array.from({ length: usadas }, () => []);
  if (!alturaDe) {
    for (let i = 0; i < quantidade; i++) saida[i % usadas].push(i);
    return saida;
  }

  const altura = new Array<number>(usadas).fill(0);
  for (let i = 0; i < quantidade; i++) {
    let escolhida = 0;
    for (let c = 1; c < usadas; c++) {
      /* `<` e não `<=`: no empate fica a mais à esquerda, e é isso que põe as
         primeiras fotos em 0, 1, 2 com todas as colunas ainda zeradas. */
      if (altura[c] < altura[escolhida]) escolhida = c;
    }
    saida[escolhida].push(i);
    /* Proporção inválida (foto sem largura/altura no banco) não pode virar
       NaN: uma coluna com altura NaN nunca mais seria escolhida, e todas as
       fotos seguintes cairiam numa coluna só. */
    const h = alturaDe(i);
    altura[escolhida] += Number.isFinite(h) && h > 0 ? h : 1;
  }
  return saida;
}

/**
 * Agrupa os índices em FILEIRAS que preenchem a largura inteira — o panorama.
 *
 * ── POR QUE O PANORAMA DEIXOU DE SER UMA GRADE DE CSS (16/09/2026) ────────
 *
 * Felipe: "na panorama, a foto não está bem encaixada nos limites, a segunda
 * foto da esquerda pra direita fica um espaço grande em branco".
 *
 * O desenho anterior era `grid` com linhas de altura FIXA (`gridAutoRows`) e
 * cada foto ocupando duas delas. Isso só fecha certo para uma proporção: a de
 * retrato 2:3. Uma foto quadrada na mesma caixa desenha a largura inteira e
 * dois terços da altura — o terço que sobra é o branco da foto dele. E quando a
 * deitada pedia duas colunas com apenas uma sobrando na fileira, o próprio CSS
 * empurrava a foto para a fileira seguinte e deixava o vão para trás.
 *
 * Fileira justificada não tem como deixar vão: a altura da fileira é CALCULADA
 * para que as larguras naturais das fotos somem exatamente a largura
 * disponível. Nada é cortado — que é a promessa das grades "colunas", "linhas"
 * e "panorama" — e a deitada continua ocupando o dobro da vizinha, porque é
 * mais larga na mesma altura.
 *
 * @param unidadesPorFileira Quantas colunas a tela comporta. A deitada vale
 *   duas; as outras, uma. É o que mantém o panorama parecido com uma grade em
 *   vez de virar uma fileira só de vinte fotos.
 */
export function agruparEmFileiras(
  proporcoes: readonly number[],
  unidadesPorFileira: number,
): number[][] {
  const teto = Math.max(1, Math.floor(unidadesPorFileira));
  const fileiras: number[][] = [];
  let atual: number[] = [];
  let unidades = 0;

  for (let i = 0; i < proporcoes.length; i++) {
    const peso = Math.min(teto, colunasDoItem(proporcoes[i], teto));
    /* Não cabe: fecha a fileira ANTES de pôr a foto. Fechar depois deixaria a
       fileira com mais unidades que a tela, e a conta da altura devolveria uma
       fileira mais baixa que as vizinhas — o degrau que a grade de CSS fazia. */
    if (unidades > 0 && unidades + peso > teto) {
      fileiras.push(atual);
      atual = [];
      unidades = 0;
    }
    atual.push(i);
    unidades += peso;
    if (unidades >= teto) {
      fileiras.push(atual);
      atual = [];
      unidades = 0;
    }
  }
  if (atual.length) fileiras.push(atual);
  return fileiras;
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
