/**
 * QUAIS FOTOS FICAM MARCADAS DEPOIS DE UM CLIQUE NA GRADE DO PAINEL.
 *
 * ── DE ONDE VEIO (25/09/2026) ─────────────────────────────────────────────
 *
 * Juan: "adicionar a função de selecionar várias através do comando 'segurar
 * shift ou alt', como é padrão na movimentação de arquivos. Clica em uma,
 * segura shift, clica em outra. E todas entre elas serem selecionadas."
 *
 * É o gesto do Explorer e do Finder, e ele o chama de padrão porque é. Sem ele
 * havia dois caminhos — "selecionar todas" ou um clique por foto — e o que o
 * fotógrafo faz o dia inteiro é o do meio: pegar o trecho que virou Cerimônia
 * e mandar para lá de uma vez. Na entrega de 4.577 arquivos dele, um trecho de
 * 300 fotos eram 300 cliques.
 *
 * ── POR QUE ISTO É UM MÓDULO, E NÃO UM PEDAÇO DO COMPONENTE ───────────────
 *
 * Porque aqui mora o que pode dar errado, e nenhum teste desta casa abre
 * navegador: as suítes falam HTTP, banco e HTML. Dentro do `onClick` esta
 * regra seria intestável, e são três invariantes que um futuro ajuste quebra
 * sem perceber — o intervalo FECHADO nas duas pontas, o trecho que só ACRESCENTA
 * e a âncora que NÃO ANDA. `testar-trecho-selecionado.mjs` prende as três.
 *
 * Função pura de propósito: nada de React, nada de `server-only`. Recebe o
 * estado, devolve o próximo.
 */

export interface DepoisDoClique {
  /** Quem fica marcado. */
  selecao: Set<string>;
  /** De onde o próximo shift-clique vai medir o trecho. */
  ancora: string | null;
}

/**
 * @param ordem    os ids NA ORDEM EM QUE A TELA OS DESENHA — é o que define o
 *                 "entre elas" do pedido. Ordenar a galeria muda esta lista, e
 *                 tem de mudar: o trecho é o que se vê, não o que o banco guarda.
 * @param atual    quem já estava marcado.
 * @param clicada  o id clicado agora.
 * @param ancora   o último clique SEM shift, ou nulo se ainda não houve nenhum.
 * @param comShift se a tecla estava segurada.
 */
export function depoisDoClique(
  ordem: readonly string[],
  atual: ReadonlySet<string>,
  clicada: string,
  ancora: string | null,
  comShift: boolean,
): DepoisDoClique {
  const nova = new Set(atual);
  const ate = ordem.indexOf(clicada);
  const de = ancora === null ? -1 : ordem.indexOf(ancora);

  /*
   * Shift sem âncora é o primeiro clique da pessoa na grade. Aí ele vale como
   * clique comum: inventar um trecho a partir da primeira foto marcaria
   * centenas que ninguém pediu, e desfazer isso é pior que não ter o recurso.
   *
   * `de`/`ate` negativos são a âncora ou a foto que saíram da lista — remover
   * uma foto e depois clicar com shift, por exemplo. Também cai no comum.
   */
  if (comShift && de >= 0 && ate >= 0) {
    const [inicio, fim] = de < ate ? [de, ate] : [ate, de];
    /* Fechado nas duas pontas: "clica em uma, segura shift, clica em outra, e
       TODAS entre elas" inclui as duas que ele clicou. */
    for (let k = inicio; k <= fim; k++) nova.add(ordem[k]);
    /*
     * A ÂNCORA NÃO ANDA. Quem segura shift e clica de novo mais adiante quer
     * CORRIGIR onde o trecho termina, não começar outro a partir daqui — é o
     * que os dois gerenciadores de arquivos fazem. Movê-la faria a segunda
     * tentativa marcar o intervalo errado, sem nenhum aviso.
     */
    return { selecao: nova, ancora };
  }

  if (nova.has(clicada)) nova.delete(clicada);
  else nova.add(clicada);
  return { selecao: nova, ancora: clicada };
}
