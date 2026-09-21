import type { LinhasTitulo } from "@/config/aparencia";

/**
 * O TÍTULO DA CAPA: quanto ele mede, e onde ele quebra.
 *
 * Puro e sem React de propósito — a regra de quebra tem casos que só se veem
 * comparando resultados (nome de uma palavra em três linhas, "&" solto, palavra
 * mais longa que a linha), e nenhum deles se confere olhando a tela uma vez.
 * Dentro do componente ela só carregaria junto com o React e não rodaria numa
 * suíte de linha de comando.
 */

/**
 * Quanto o texto mede, em `em` da própria fonte.
 *
 * Uma estimativa, e ela existe para uma coisa só: garantir que a linha CAIBA.
 * Com `white-space: nowrap` e um nome comprido, o navegador não quebra nem
 * encolhe — ele transborda, e a galeria inteira ganha rolagem horizontal.
 * Sabendo a largura aproximada dá para pedir ao CSS o MENOR entre "o tamanho
 * que a pessoa escolheu" e "o tamanho que cabe".
 *
 * Os números são médias de serifada e sem-serifa; nenhuma fonte bate exato, e
 * não precisa — errar para menos só desenha um título um pouco menor do que
 * caberia, enquanto errar para mais quebra a página. Daí a folga de 6% no fim.
 */
export function larguraDoTituloEm(titulo: string): number {
  let em = 0;
  for (const c of titulo) {
    if (c === " ") em += 0.26;
    else if (c === "&") em += 0.7;
    else if (c === c.toUpperCase() && c !== c.toLowerCase()) em += 0.72;
    else if (/[0-9]/.test(c)) em += 0.5;
    else if (/[ijltIl.,'’!|]/.test(c)) em += 0.28;
    else em += 0.47;
  }
  return Math.max(1, em) * 1.06;
}

/** O comprimento das palavras `[i, j)` escritas juntas, com os espaços. */
function comprimento(palavras: string[], i: number, j: number): number {
  let n = -1;
  for (let k = i; k < j; k++) n += palavras[k].length + 1;
  return n;
}

/**
 * Distribui as palavras em `alvo` linhas, deixando-as o mais parecidas
 * possível.
 *
 * Programação dinâmica e não repartição gulosa: a gulosa enche a primeira linha
 * até o limite e deixa a sobra para a última, que é como se produz
 * "Maria Eduarda &" / "Silva" em vez de "Maria Eduarda" / "& Silva". O custo é
 * irrelevante — títulos têm meia dúzia de palavras.
 *
 * A ordem das palavras nunca muda, e nenhuma palavra é partida: o que se
 * escolhe são os pontos de corte.
 */
function agruparEmLinhas(palavras: string[], alvo: number): string[] {
  const total = palavras.length;
  const linhas = Math.min(alvo, total);
  if (linhas <= 1) return [palavras.join(" ")];

  const memo = new Map<string, { maior: number; corte: number }>();
  const resolver = (i: number, k: number): { maior: number; corte: number } => {
    const chave = `${i}:${k}`;
    const guardado = memo.get(chave);
    if (guardado) return guardado;

    if (k === 1) {
      const r = { maior: comprimento(palavras, i, total), corte: total };
      memo.set(chave, r);
      return r;
    }

    let melhor = { maior: Infinity, corte: i + 1 };
    /* Cada uma das `k-1` linhas seguintes precisa sobrar com pelo menos uma
       palavra, senão o corte produziria linha vazia. */
    for (let j = i + 1; j <= total - (k - 1); j++) {
      const resto = resolver(j, k - 1);
      const maior = Math.max(comprimento(palavras, i, j), resto.maior);
      if (maior < melhor.maior) melhor = { maior, corte: j };
    }
    memo.set(chave, melhor);
    return melhor;
  };

  const saida: string[] = [];
  let i = 0;
  for (let k = linhas; k >= 1; k--) {
    const { corte } = resolver(i, k);
    saida.push(palavras.slice(i, corte).join(" "));
    i = corte;
  }
  return saida;
}

/**
 * Em quantas linhas o título vai sair — e quais são elas.
 *
 * ── POR QUE NÃO DÁ PARA FAZER ISSO COM LARGURA (17/09/2026) ───────────────
 *
 * Felipe, com "Júlia & Gustavo" e "3 linhas" marcado: "aqui o 3 linhas não está
 * em 3, está apenas em 2".
 *
 * Até aqui "2 linhas" e "3 linhas" eram uma `max-width` estreita, na esperança
 * de que o navegador quebrasse onde se queria. Largura não conta linha: ela
 * IMPEDE que a linha passe de um tamanho, e o navegador usa quantas linhas
 * precisar — nunca mais do que precisa. Com "Júlia & Gustavo", três linhas
 * pediam uma caixa de 5 caracteres, mas o piso da maior palavra ("Gustavo",
 * sete) abria a caixa para oito, e em oito "Júlia &" cabe: duas linhas.
 *
 * O piso não era o defeito — sem ele a palavra transborda. O defeito era o
 * mecanismo: pedir um NÚMERO de linhas e entregar um LIMITE de largura.
 *
 * Agora as linhas são decididas aqui e desenhadas com quebra explícita. O
 * pedido vira o que ele diz ser.
 *
 * @returns as linhas, ou `null` quando quem decide é o navegador (`auto`).
 */
export function linhasDoTitulo(titulo: string, linhas: LinhasTitulo): string[] | null {
  /* `String(... ?? "")` e não `titulo.trim()`: o tipo diz que é string, e o
     VALOR vem do banco por um caminho que passa por JSON. Uma galeria antiga
     com título nulo derrubaria a capa — e a capa é a primeira coisa que o casal
     vê. Ver `desenhoDoTitulo`. */
  const limpo = String(titulo ?? "").trim().replace(/\s+/g, " ");
  if (!limpo) return null;
  if (linhas === "auto") return null;
  if (linhas === "uma") return [limpo];

  const palavras = limpo.split(" ");
  /*
   * Menos palavras que linhas pedidas é pedido impossível: não se parte palavra
   * no meio para preencher a conta. "Casamento" em três linhas sai em uma, e é
   * o certo — a alternativa seria "Casa-" / "men-" / "to".
   */
  return agruparEmLinhas(palavras, linhas === "duas" ? 2 : 3);
}

/**
 * A CAIXA DO `auto`, medida em `em`.
 *
 * A capa escreve `max-width: 22ch`, e `ch` é a largura do "0" — que na maioria
 * das fontes fica perto de meio `em`. Então 22ch cabem uns 11 `em` de texto, e é
 * esse o número contra o qual uma palavra precisa ser medida para se saber se
 * ela cabe. Aproximado de propósito: o que se decide com ele é se vale QUEBRAR
 * a palavra, e errar por pouco só muda o tratamento de um nome que já estava no
 * limite.
 */
const CABE_NA_CAIXA_EM = 11;

/**
 * TEM PALAVRA QUE NÃO CABE NA CAIXA? — a que obriga a quebrar no meio.
 *
 * ── DE ONDE VEIO (21/09/2026) ─────────────────────────────────────────────
 *
 * Na opção `auto` quem quebra o título é o navegador, e ele só quebra nos
 * ESPAÇOS. Título de uma palavra só — um nome composto digitado sem espaço, por
 * exemplo — não tem onde quebrar: passava da caixa de 22ch e levava a PÁGINA
 * junto. Medido antes do conserto: 24 de 70 combinações de título × capa ×
 * largura davam rolagem horizontal na galeria inteira, e no celular a capa
 * "convite" chegava a 799 px numa tela de 390 — o convidado arrastava a galeria
 * de lado para ler o nome do casal.
 *
 * A resposta é deixar o navegador quebrar dentro da palavra. Só que isso não
 * pode valer para TODO título: junto com `text-wrap: balance`, que a capa usa
 * para repartir bem "Nathalia & Matheus", a permissão de quebrar em qualquer
 * ponto faz o balanceador escolher o mínimo — e o nome sai UMA LETRA POR LINHA,
 * escrito de cima para baixo. Medido também, com print.
 *
 * Por isso a pergunta: só o título que tem uma palavra maior que a caixa troca
 * `balance` por quebra. Os outros continuam exatamente como estão.
 */
export function temPalavraQueNaoCabe(titulo: string): boolean {
  const palavras = String(titulo ?? "").trim().split(/\s+/).filter(Boolean);
  return palavras.some((p) => larguraDoTituloEm(p) > CABE_NA_CAIXA_EM);
}

/**
 * O DESENHO DO TÍTULO — e a promessa de que ele NUNCA derruba a galeria.
 *
 * ── DE ONDE VEIO (18/09/2026) ─────────────────────────────────────────────
 *
 * Em 17/09 este arquivo foi ao ar e, minutos depois, o Felipe mandou a galeria
 * de um casamento entregue mostrando "Alguma coisa saiu do lugar". Eu revertí
 * tudo no mesmo dia sem nunca ter reproduzido a falha — varri 56 combinações de
 * capa, linha e logo, todas HTTP 200.
 *
 * Reverter estava certo (galeria de cliente fora do ar não espera diagnóstico) e
 * era insuficiente: continuava possível uma entrada esquisita — título nulo numa
 * galeria antiga, uma opção de linha que o validador deixasse passar — tirar do
 * ar a página INTEIRA por causa de onde o nome quebra.
 *
 * A troca é de hierarquia, e vale independentemente de qual era o defeito: a
 * repartição em linhas é PREFERÊNCIA de tipografia; a galeria é o produto. Se a
 * conta falhar, a capa cai no automático — que é exatamente como ela era antes
 * de "2 linhas" e "3 linhas" existirem — e o `console.error` deixa a falha no
 * log do servidor, onde dá para achá-la sem cliente esperando.
 *
 * É a única porta que o componente usa. Uma porta total, para ninguém ter de
 * lembrar de proteger a chamada.
 */
export function desenhoDoTitulo(
  titulo: string,
  pedido: LinhasTitulo,
): { linhas: string[] | null; larguraEm: number } {
  try {
    const linhas = linhasDoTitulo(titulo, pedido);
    /* A fonte é limitada pela MAIOR das linhas: é ela que transborda primeiro.
       O `""` inicial existe para o `reduce` não estourar com lista vazia — que
       `linhasDoTitulo` não devolve hoje, e é justamente o tipo de "hoje" que
       derrubou a galeria uma vez. */
    const maior = linhas?.length
      ? linhas.reduce((a, b) => (larguraDoTituloEm(a) >= larguraDoTituloEm(b) ? a : b), "")
      : String(titulo ?? "");
    return { linhas: linhas?.length ? linhas : null, larguraEm: larguraDoTituloEm(maior) };
  } catch (erro) {
    /* O log fica; a galeria também. */
    console.error("desenhoDoTitulo falhou — a capa cai no automático", erro);
    return { linhas: null, larguraEm: 1 };
  }
}
