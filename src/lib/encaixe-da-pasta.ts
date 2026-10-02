/**
 * O QUE FALTAVA DA PASTA VOLTA PARA O MEIO DELA (02/10/2026).
 *
 * Equipe da Carol Tedesco, mandando de novo a cerimônia de um casamento: "na
 * pasta do note tá em ordem, mas no link tá subindo desorganizado".
 *
 * Mandar de novo a mesma pasta é o que se faz depois de um envio que travou,
 * que a página recarregou no meio, ou em que algumas fotos desistiram. Desde
 * 01/10 a tela reconhece as que já estão na galeria (mesmo nome e mesmo
 * tamanho) e sobe só as que faltam. Só que a posição de cada arquivo novo é
 * "depois de tudo o que a galeria já tinha" — então a foto 37, que tinha
 * falhado, chegava DEPOIS da 412, no fim do capítulo.
 *
 * No fim do envio, as fotos da pasta são postas na ordem da pasta, cada
 * capítulo por si:
 *
 *  - só as linhas que SÃO da pasta se mexem (mesmo nome e mesmo tamanho, a
 *    régua de `separarRepetidos`); o resto do capítulo fica onde estava;
 *  - elas trocam de lugar entre si, nas posições que já ocupavam — nenhuma
 *    outra foto da galeria anda;
 *  - SÓ quando as que já estavam lá continuam na ordem da pasta. Se o
 *    fotógrafo arrastou alguma, a ordem do capítulo é dele, e o envio não
 *    desfaz isso: as novas ficam no fim, como antes.
 *
 * Quem "Enviar mesmo assim" também passa por aqui: a cópia nova cai do lado
 * da antiga, e apagar as cópias extras deixa o capítulo na ordem da pasta.
 *
 * Pura e sem banco: `scripts/testar-encaixe-da-pasta.mjs` cobre as regras.
 */

export interface ArquivoDaPasta {
  nome: string;
  bytes: number;
}

export interface LinhaDoCapitulo {
  id: string;
  nome: string;
  bytes: number;
  ordem: number;
  /** Nasceu NESTE envio. */
  doEnvio: boolean;
}

/** A mesma régua de `separarRepetidos`: o Windows e o macOS não distinguem caixa. */
const chave = (nome: string, bytes: number) => `${nome.toLowerCase()}\u0000${bytes}`;

/**
 * As posições novas das linhas de UM capítulo.
 *
 * `linhas` vem na ordem em que a galeria mostra (`ordem, criado_em, id`);
 * `pasta`, na ordem em que o envio a percorreu. Devolve só quem muda.
 */
export function encaixarNaPasta(
  linhas: LinhaDoCapitulo[],
  pasta: ArquivoDaPasta[],
): { id: string; ordem: number }[] {
  const lugar = new Map<string, number>();
  pasta.forEach((a, i) => {
    const k = chave(a.nome, a.bytes);
    if (!lugar.has(k)) lugar.set(k, i);
  });

  const daPasta = linhas
    .map((l) => ({ l, i: lugar.get(chave(l.nome, l.bytes)) }))
    .filter((x): x is { l: LinhaDoCapitulo; i: number } => x.i !== undefined);

  /* Sem as duas metades não há o que encaixar: ou é um envio novo, ou o
     capítulo não recebeu nada desta pasta. */
  if (!daPasta.some((x) => x.l.doEnvio) || !daPasta.some((x) => !x.l.doEnvio)) return [];

  /* A ordem que o fotógrafo deu vence: se as que já estavam lá saíram da
     ordem da pasta, alguém as arrumou de propósito. */
  let anterior = -1;
  for (const x of daPasta) {
    if (x.l.doEnvio) continue;
    if (x.i < anterior) return [];
    anterior = x.i;
  }

  /* `sort` é estável: duas cópias do mesmo arquivo ficam na ordem em que já
     estavam — a antiga antes da nova. */
  const desejada = [...daPasta].sort((a, b) => a.i - b.i);
  const posicoes = daPasta.map((x) => x.l.ordem);
  const mudam: { id: string; ordem: number }[] = [];

  if (posicoes.every((p, k) => k === 0 || p > posicoes[k - 1])) {
    desejada.forEach((x, k) => {
      if (x.l.ordem !== posicoes[k]) mudam.push({ id: x.l.id, ordem: posicoes[k] });
    });
    return mudam;
  }

  /* Posição repetida — galeria de antes do lote de 23/09, ou de dois envios
     que se empurraram antes da migração 061. Trocar as linhas de lugar não
     desempata ninguém; o capítulo é renumerado em sequência a partir de onde
     começava, como faz o "ordenar…" do capítulo. */
  const daVez = desejada.map((x) => x.l);
  let k = 0;
  const final = linhas.map((l) => (lugar.has(chave(l.nome, l.bytes)) ? daVez[k++] : l));
  const inicio = Math.min(...linhas.map((l) => l.ordem));
  final.forEach((l, n) => {
    if (l.ordem !== inicio + n) mudam.push({ id: l.id, ordem: inicio + n });
  });
  return mudam;
}
