#!/usr/bin/env node
/**
 * O QUE É "FIM DA GALERIA", E O QUE É SÓ A REDE CAINDO. Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *        scripts/testar-fim-da-galeria.mjs
 *
 * Não precisa de banco nem de servidor: é régua pura.
 *
 * ── O DEFEITO QUE ISTO PRENDE (achado em 02/10/2026) ──────────────────────
 *
 * A galeria fatiada (acima de 600 fotos) pede o resto rolando. Quando a rede
 * cai no meio, `carregarMais` para de tentar — de propósito, e o motivo está
 * escrito lá: "insistir em laço numa conexão ruim é o que trava o celular do
 * convidado no salão".
 *
 * O jeito como ela parava, porém, era marcar `acabou = true`. E `acabou` é
 * metade da definição de FIM: é ele que libera a saída do capítulo e, desde
 * 01/10/2026, a despedida do fotógrafo e o "Volte ao início".
 *
 * Então, no 4G do salão, com 600 de 1200 fotos na tela, o convidado recebia
 * "Obrigado por escolher o nosso olhar para esse dia inesquecível" — a frase que
 * o fotógrafo escreveu para o fim — no meio da entrega, e nada dizendo que
 * faltavam 600 fotos. A galeria mentia sobre o próprio tamanho.
 *
 * ── POR QUE A RÉGUA SAIU DO COMPONENTE ────────────────────────────────────
 *
 * Porque este defeito não dá para pegar pelo HTML: ele só acontece com a rede
 * caindo no navegador de outra pessoa. Separar a DECISÃO do desenho é o que
 * torna a regra verificável — o componente passa os quatro fatos e obedece.
 */
import { chegouAoFim } from "../src/lib/fim-da-galeria.ts";

let falhou = false;
const etapa = (nome, fn) => {
  try {
    const d = fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
};
const certo = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${b}, veio ${a}`);
};

const estado = (extra) => ({
  fatiada: false,
  acabou: false,
  falhou: false,
  faltaDesenhar: false,
  ...extra,
});

console.log("Fim da galeria:\n");

etapa("galeria pequena, tudo desenhado: é o fim", () => {
  certo(chegouAoFim(estado({})), true, "fim");
});

etapa("ainda falta desenhar: não é o fim", () => {
  /* As fotos já estão na memória, mas a grade ainda está montando os cards.
     Despedir-se aqui seria despedir-se de uma tela incompleta. */
  certo(chegouAoFim(estado({ faltaDesenhar: true })), false, "fim");
});

etapa("galeria fatiada ainda rolando: não é o fim", () => {
  certo(chegouAoFim(estado({ fatiada: true })), false, "fim");
});

etapa("galeria fatiada que terminou de chegar: é o fim", () => {
  certo(chegouAoFim(estado({ fatiada: true, acabou: true })), true, "fim");
});

etapa("REDE CAIU numa galeria fatiada: NÃO é o fim", () => {
  /* O caso que dava a despedida no meio da entrega. */
  certo(chegouAoFim(estado({ fatiada: true, falhou: true })), false, "fim");
});

etapa("rede caiu E o servidor já tinha dito que acabou: é o fim", () => {
  /* Os dois sinais juntos só acontecem se uma falha vier DEPOIS da última
     remessa. Aí a galeria está inteira na tela, e esconder o fim por causa de
     um pedido que nem era necessário seria tirar a despedida de quem viu tudo. */
  certo(chegouAoFim(estado({ fatiada: true, acabou: true, falhou: true })), true, "fim");
});

etapa("rede caiu numa galeria NÃO fatiada: é o fim", () => {
  /* Sem fatia não há o que pedir, então nenhuma falha de rolagem pode mudar o
     fato de que tudo o que existe já está desenhado. */
  certo(chegouAoFim(estado({ falhou: true })), true, "fim");
});

console.log(falhou ? "\n✗ a régua do fim não fecha" : "\n✓ fim é fim; rede caindo não é");
process.exitCode = falhou ? 1 : 0;
