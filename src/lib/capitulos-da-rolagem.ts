/**
 * Onde entram, nos capítulos, as fotos que a rolagem infinita trouxe.
 *
 * ── O DEFEITO QUE ISTO EXISTE PARA TORNAR IMPOSSÍVEL (17/09/2026) ─────────
 *
 * O cliente RECALCULAVA os capítulos do zero assim que o segundo pedaço
 * chegava, percorrendo a lista inteira e perguntando `it.secaoId === c.id`.
 *
 * As fotos da rota `/mais` traziam `secaoId`; as do documento inicial, não — o
 * servidor já mandava os índices prontos, então o campo parecia dispensável.
 * No instante da primeira carga, as 600 primeiras deixavam de pertencer a
 * capítulo nenhum e SUMIAM da tela.
 *
 * Juan, rolando o Making Of de um casamento entregue: "to descendo as fotos do
 * making of e buga, vai para as fotos da decoração e diminui a página do making
 * of". Medido no navegador: 601 imagens viravam 121 e a página caía de 192.661
 * px para 42.275.
 *
 * ── POR QUE NÃO BASTOU MANDAR O CAMPO ────────────────────────────────────
 *
 * Mandar o `secaoId` no documento conserta o dia. Não impede o próximo: a
 * recontagem do zero depende de TODA foto carregar um campo certo, e quem
 * escrever a próxima fonte de fotos não tem como saber disso.
 *
 * Aqui a recontagem não existe. Os índices que o servidor mandou ficam como
 * estão, e só as fotos NOVAS são classificadas. Uma foto que já estava na tela
 * não tem como sair dela — não há caminho no código que a tire.
 */

export interface ItemComCapitulo {
  secaoId?: string | null;
}

export interface CapituloComIndices {
  id: string;
  indices: number[];
}

/**
 * @param capitulosIniciais o que o servidor mandou, com os índices do primeiro
 *   pedaço já prontos
 * @param quantasIniciais quantas fotos vieram no documento — os índices dos
 *   extras começam daí
 * @param extras as fotos que a rolagem trouxe, na ordem em que chegaram
 */
export function capitulosComOsExtras<C extends CapituloComIndices>(
  capitulosIniciais: readonly C[],
  quantasIniciais: number,
  extras: readonly ItemComCapitulo[],
): C[] {
  if (extras.length === 0) return capitulosIniciais as C[];

  return capitulosIniciais.map((c) => {
    const novos: number[] = [];
    for (let k = 0; k < extras.length; k++) {
      const it = extras[k];
      /* "sem-capitulo" é um balde de verdade, e não a ausência de resposta: é
         onde ficam as fotos que o fotógrafo não organizou. */
      const dele = c.id === "sem-capitulo" ? !it.secaoId : it.secaoId === c.id;
      if (dele) novos.push(quantasIniciais + k);
    }
    /* Sem foto nova, devolve o mesmo objeto: o React compara por referência, e
       trocar todos eles redesenharia a galeria inteira a cada carga. */
    return novos.length === 0 ? c : { ...c, indices: [...c.indices, ...novos] };
  });
}
