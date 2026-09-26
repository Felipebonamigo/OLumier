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
 *
 * ── A GRADE "COLUNAS" VIROU FILEIRAS (26/09/2026) ─────────────────────────
 *
 * Até aqui ela era um mural de verdade: colunas de largura fixa, cada foto na
 * coluna mais curta. Juan reclamou da ordem quatro vezes — a última com o
 * print numerado à mão, "era pra ser 1 2 3 4 5, mas está 2 - 1 - 4 - 5 - 3" —
 * e o Felipe fechou a questão: "não pode trocar, ele tem que seguir a ordem".
 *
 * Num mural de colunas com fotos de alturas diferentes isso é impossível, e
 * não por falta de regra: com duas colunas, uma deitada e retratos depois, a
 * única distribuição que nunca lê fora de ordem é empilhar tudo numa coluna
 * só. Medido em galerias sortidas: a regra "coluna mais curta" lia 35 de cada
 * 100 pares seguidos ao contrário; a melhor variante ainda lia 17, e as mais
 * agressivas passavam a jogar fotos posteriores para cima das anteriores.
 * Colunas iguais + nada cortado + ordem garantida só se consegue deixando
 * buraco — 14% da grade vazia numa galeria com um quarto de horizontais.
 *
 * O Felipe escolheu ceder na LARGURA: a "Colunas" monta fileiras com o mesmo
 * número de fotos que tem de colunas, cada fileira esticada até a borda. A
 * ordem é a da leitura por construção — cada fileira é um trecho contínuo, da
 * esquerda para a direita —, nada é cortado e não sobra buraco. A horizontal
 * sai mais larga, na mesma altura das vizinhas.
 *
 * O que a separa da "Panorama" é a conta da fileira: lá a deitada vale por
 * duas e a fileira tem menos fotos; aqui toda fileira tem exatamente N.
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
 * @param deitadaValeDuas `false` é a grade "Colunas" (26/09/2026): toda foto
 *   vale uma, e cada fileira tem exatamente `unidadesPorFileira` fotos — o
 *   número de colunas que a pessoa escolheu pela densidade. A deitada continua
 *   saindo mais larga, porque a fileira é justificada pela proporção de cada
 *   foto; o que muda é que ela não empurra ninguém para a fileira seguinte.
 */
export function agruparEmFileiras(
  proporcoes: readonly number[],
  unidadesPorFileira: number,
  deitadaValeDuas = true,
): number[][] {
  const teto = Math.max(1, Math.floor(unidadesPorFileira));
  const fileiras: number[][] = [];
  let atual: number[] = [];
  let unidades = 0;

  for (let i = 0; i < proporcoes.length; i++) {
    const peso = deitadaValeDuas ? Math.min(teto, colunasDoItem(proporcoes[i], teto)) : 1;
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
