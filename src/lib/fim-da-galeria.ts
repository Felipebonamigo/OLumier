/**
 * QUANDO A GALERIA ACABOU DE VERDADE.
 *
 * A pergunta parece boba e não é: a galeria fatiada (acima de 600 fotos) pede o
 * resto conforme a pessoa rola, e "não vem mais foto" tem duas causas
 * diferentes que até 02/10/2026 moravam na mesma variável:
 *
 *   · o servidor disse que acabou  → é o fim;
 *   · a rede caiu                  → NÃO é o fim, é uma interrupção.
 *
 * `carregarMais` marcava as duas como `acabou`, porque o que ele precisava era
 * só parar de tentar ("insistir em laço numa conexão ruim é o que trava o
 * celular do convidado no salão"). Funcionou enquanto `acabou` não decidia nada
 * visível. Desde 01/10/2026 ele decide: libera a saída do capítulo, a despedida
 * escrita pelo fotógrafo e o "Volte ao início".
 *
 * Resultado no 4G do salão: 600 de 1200 fotos na tela e a frase de despedida do
 * casamento no meio da entrega, sem nada dizendo que faltava metade.
 *
 * Esta função existe fora do componente porque o caso só acontece com a rede
 * caindo no navegador de outra pessoa — nenhum teste de HTML o alcança. Separada,
 * ela é régua pura e tem teste (`scripts/testar-fim-da-galeria.mjs`).
 */
export interface EstadoDoFim {
  /** A entrega é fatiada? Sem fatia, tudo o que existe já está na tela. */
  fatiada: boolean;
  /** A última remessa chegou — o servidor disse que não há mais. */
  acabou: boolean;
  /** Um pedido de mais fotos falhou e a rolagem automática parou. */
  falhou: boolean;
  /** Ainda há cards na fila de desenho da grade. */
  faltaDesenhar: boolean;
}

export function chegouAoFim(e: EstadoDoFim): boolean {
  /* A fila de desenho vem primeiro: as fotos podem estar todas na memória e a
     grade ainda estar montando os cards. */
  if (e.faltaDesenhar) return false;
  /* Falha só esconde o fim na entrega FATIADA e enquanto o fim não foi
     confirmado. Sem fatia não há o que pedir, então nenhuma falha de rolagem
     muda o fato de que tudo já está na tela. E os dois sinais juntos acontecem
     quando uma falha vem DEPOIS da última remessa — a galeria está inteira, e
     tirar a despedida de quem viu tudo seria o erro oposto. */
  if (e.fatiada && e.falhou && !e.acabou) return false;
  return !e.fatiada || e.acabou;
}
