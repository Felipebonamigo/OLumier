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
 * As fileiras da grade "Colunas": N fotos por fileira, na ordem, e nenhuma
 * fileira curta no fim.
 *
 * Toda foto vale uma — ao contrário da Panorama, a deitada não empurra
 * ninguém para a fileira seguinte; ela sai mais larga porque a fileira é
 * justificada pela proporção de cada foto.
 *
 * ── SEM ESPAÇO VAZIO NO FIM (26/09/2026) ──────────────────────────────────
 *
 * Felipe, com as fileiras já no lugar do mural: "tente deixar sem
 * espaçamento, é importante seguir a ordem". O único vazio que sobrava era o
 * fim: 48 fotos em fileiras de 5 deixavam uma última fileira de 3, e ela não
 * pode ser esticada até a borda sem virar três fotos do tamanho de um pôster.
 *
 * Então a falta é REPARTIDA pelas últimas fileiras: em vez de 5 + 5 + 3,
 * 5 + 4 + 4. Faltando `N − k` fotos para a última fechar, as `N − k` últimas
 * fileiras levam uma a menos cada, e todas chegam à borda. Nenhuma fileira
 * fica com menos de N − 1 fotos, então as do fim saem no máximo `N / (N − 1)`
 * maiores que as outras — 25% com cinco colunas — em vez de o dobro ou mais.
 * A ordem não muda: continua sendo uma fatia contínua por fileira.
 *
 * Galeria pequena demais para repartir assim (menos fileiras do que fotos
 * faltando) reparte o que dá, o mais igual possível.
 *
 * `listaCompleta = false` é a galeria fatiada, que chega rolando (ver
 * `config/fatia-galeria.ts`): enquanto vem mais, o fim do lote não é o fim da
 * galeria, e repartir ali faria as fotos de baixo mudarem de fileira na frente
 * da pessoa quando o próximo lote chegasse. Nesse caso a última fileira fica
 * curta — e ganha as fotos que faltam assim que elas chegam.
 */
export function fileirasDeColunas(
  quantidade: number,
  colunas: number,
  listaCompleta = true,
): number[][] {
  const n = Math.max(1, Math.floor(colunas));
  const q = Math.max(0, Math.floor(quantidade));
  const inteiras = Math.floor(q / n);
  const sobra = q % n;

  /* Quantas fotos cada fileira leva, de cima para baixo. */
  let tamanhos: number[];
  if (sobra === 0 || inteiras === 0 || !listaCompleta) {
    tamanhos = Array.from({ length: inteiras }, () => n);
    if (sobra) tamanhos.push(sobra);
  } else {
    const fileiras = inteiras + 1;
    const faltam = n - sobra;
    if (faltam <= fileiras) {
      tamanhos = Array.from({ length: fileiras }, (_, f) => (f >= fileiras - faltam ? n - 1 : n));
    } else {
      /* Poucas fileiras: tudo o mais igual possível, as maiores em cima. */
      const base = Math.floor(q / fileiras), maiores = q % fileiras;
      tamanhos = Array.from({ length: fileiras }, (_, f) => base + (f < maiores ? 1 : 0));
    }
  }

  const saida: number[][] = [];
  let i = 0;
  for (const t of tamanhos) {
    saida.push(Array.from({ length: t }, (_, k) => i + k));
    i += t;
  }
  return saida;
}

/**
 * As fileiras da grade "Linhas": fotos na altura-alvo, cada fileira
 * justificada até a borda — sem cortar nada e sem sobra à direita.
 *
 * ── A BARRA BRANCA (28/09/2026) ───────────────────────────────────────────
 *
 * Felipe, com o print de uma galeria no celular: "tem fotos que não ocupam o
 * tamanho correto, aquela ali tá com uma barra branca do lado".
 *
 * A "Linhas" era `flex-wrap` com `flex-grow` igual à proporção da foto, e isso
 * tem um canto que o CSS define assim de propósito: quando a SOMA dos
 * `flex-grow` de uma linha é menor que 1, a linha distribui só essa FRAÇÃO da
 * sobra. Uma foto vertical (2:3) sozinha na linha — porque a seguinte era
 * deitada e não cabia ao lado — crescia 67% da sobra e parava; os outros 33%
 * eram a barra. As medidas do print batem com essa conta a 2 px. E a foto que
 * crescia era cortada, porque a altura era fixa: a promessa "nada é cortado"
 * desta grade não valia justamente onde ela esticava.
 *
 * Agora é a mesma matemática da Panorama e da Colunas — fileira justificada,
 * altura = largura útil ÷ soma das proporções —, com a quebra escolhida pela
 * altura: a fileira fecha quando a próxima foto a faria passar da borda, e
 * essa foto entra ou abre a fileira seguinte conforme o que deixar a altura
 * mais perto da alvo. A vertical que ficava sozinha agora divide a fileira
 * com a deitada, as duas um pouco mais baixas.
 *
 * ── O FIM ─────────────────────────────────────────────────────────────────
 *
 * A última fileira escolhe entre esticar até a borda e juntar-se à anterior —
 * o que ficar mais perto da altura-alvo —, desde que o resultado fique entre
 * a metade e o dobro dela. Não dando (um capítulo de uma foto vertical), ela
 * fica na altura-alvo, alinhada à esquerda, como a Colunas faz.
 *
 * Com a lista ainda chegando (`listaCompleta = false` — a leva seguinte do
 * desenho, ou a rede), a última fileira não estica nem se junta: é o fim de um
 * lote. As outras não mudam quando o resto chega — a quebra de cada fileira só
 * depende das fotos dela e da primeira da seguinte.
 */
export interface FileirasPorAltura {
  fileiras: number[][];
  /** A última fileira estica até a borda? Sem esticar, fica na altura-alvo. */
  ultimaEstica: boolean;
}

export function fileirasPorAltura(
  proporcoes: readonly number[],
  largura: number,
  alturaAlvo: number,
  gap: number,
  listaCompleta = true,
): FileirasPorAltura {
  if (proporcoes.length === 0) return { fileiras: [], ultimaEstica: false };
  /* Antes de medir não há largura para dividir: uma foto por fileira, que é o
     primeiro quadro de todas as grades de fileira. */
  if (!(largura > 0) || !(alturaAlvo > 0)) {
    return { fileiras: proporcoes.map((_, i) => [i]), ultimaEstica: false };
  }

  const justificada = (soma: number, fotos: number) => (largura - gap * (fotos - 1)) / soma;
  /* Distância em escala de proporção: 2× mais alta e 2× mais baixa pesam igual. */
  const distancia = (altura: number) => Math.abs(Math.log(altura / alturaAlvo));

  const fileiras: number[][] = [];
  let atual: number[] = [];
  let soma = 0;
  const fechar = () => {
    fileiras.push(atual);
    atual = [];
    soma = 0;
  };

  for (let i = 0; i < proporcoes.length; i++) {
    const p = proporcoes[i];
    if (atual.length > 0 && (soma + p) * alturaAlvo + gap * atual.length >= largura) {
      const com = justificada(soma + p, atual.length + 1);
      const sem = justificada(soma, atual.length);
      if (distancia(com) <= distancia(sem)) {
        atual.push(i);
        fechar();
        continue;
      }
      fechar();
    }
    atual.push(i);
    soma += p;
    /* Uma foto sozinha já mais larga que a tela na altura-alvo (um panorama
       3:1 no celular) fecha a própria fileira, um pouco mais baixa. */
    if (atual.length === 1 && p * alturaAlvo >= largura) fechar();
  }

  if (atual.length === 0) return { fileiras, ultimaEstica: true };
  if (!listaCompleta) {
    fileiras.push(atual);
    return { fileiras, ultimaEstica: false };
  }

  const dentro = (altura: number) => altura <= alturaAlvo * 2 && altura >= alturaAlvo / 2;
  const estica = justificada(soma, atual.length);
  const anterior = fileiras[fileiras.length - 1];
  const junta = anterior
    ? justificada(anterior.reduce((t, k) => t + proporcoes[k], 0) + soma, anterior.length + atual.length)
    : NaN;

  if (anterior && dentro(junta) && (!dentro(estica) || distancia(junta) < distancia(estica))) {
    anterior.push(...atual);
    return { fileiras, ultimaEstica: true };
  }
  fileiras.push(atual);
  return { fileiras, ultimaEstica: dentro(estica) };
}

/**
 * Esta fileira da "Colunas" pode ser esticada até a borda?
 *
 * Esticar deixa as fotos `colunas ÷ fotos` vezes maiores que numa fileira
 * cheia. O fim repartido por `fileirasDeColunas` fica em 25% com cinco
 * colunas, e um capítulo de três fotos em cinco colunas chega a 1,7× — ainda
 * parece a mesma galeria. Passando do dobro, não: a foto sozinha de um
 * capítulo sairia da largura da tela e mais alta que ela. Aí a fileira fica
 * com a altura de uma fileira cheia, e o vazio à direita é o de um capítulo
 * que tem poucas fotos.
 *
 * Com a galeria ainda chegando pela rolagem (`listaCompleta = false`), só a
 * fileira cheia estica: a última é o fim de um lote, não o da galeria.
 */
export function fileiraChegaNaBorda(
  fotos: number,
  colunas: number,
  listaCompleta = true,
): boolean {
  return listaCompleta ? fotos * 2 >= colunas : fotos >= colunas;
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
