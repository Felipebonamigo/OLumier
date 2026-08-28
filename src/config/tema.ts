/**
 * Tema da interface — a chave, a lista e o script de arranque, num lugar só.
 *
 * Três peças precisam concordar sobre onde a escolha fica guardada: o script
 * que roda antes da primeira pintura (em src/app/layout.tsx), o botão que grava
 * a escolha (src/components/seletor-tema.tsx) e o CSS que pinta cada tema
 * (src/app/globals.css). Se cada um escrever a string de novo, o dia em que a
 * chave mudar de nome a pessoa escolhe o tema, recarrega, e ele volta ao
 * anterior — sem erro nenhum no console.
 *
 * ── TRÊS TEMAS, DUAS MECÂNICAS ────────────────────────────────────────────
 *
 * `claro` e `escuro` são o MESMO desenho com a luz trocada, e por isso o CSS os
 * escreve numa função só (`light-dark()`); quem decide entre eles, sem escolha
 * gravada, é o `color-scheme` — ou seja, o sistema de quem abriu.
 *
 * `atomo` não é isso. É a identidade do Movimento Átomo — marrom e caramelo —
 * e mora num bloco próprio, cor por cor. Nunca é escolhido pelo sistema: só
 * entra se a pessoa pedir, porque ninguém tem "Movimento Átomo" como
 * preferência de sistema operacional.
 *
 * `scripts/testar-tema.mjs` prende as três pontas: tema que o CSS pinta e a
 * lista não oferece é um tema que ninguém alcança, e tema na lista sem regra no
 * CSS é um botão que não faz nada.
 */

export const CHAVE_TEMA = "olumier_tema";

export const TEMAS_ESCOLHIVEIS = ["claro", "escuro", "atomo"] as const;
export type TemaEscolhido = (typeof TEMAS_ESCOLHIVEIS)[number];

/**
 * O que o botão mostra.
 *
 * Ícone e não texto porque o seletor vive em barra de topo, ao lado de links
 * que já disputam a largura no celular. O rótulo continua existindo — no
 * `title` e no `aria-label` — e é ele que o leitor de tela lê.
 */
export const TEMAS: { valor: TemaEscolhido; rotulo: string; icone: string }[] = [
  { valor: "claro", rotulo: "Claro", icone: "☀" },
  { valor: "escuro", rotulo: "Escuro", icone: "☾" },
  { valor: "atomo", rotulo: "Movimento Átomo", icone: "◍" },
];

/**
 * Roda antes da primeira pintura, direto no <head>.
 *
 * Precisa ser síncrono e minúsculo: qualquer coisa que espere o React deixaria
 * a página piscar no tema errado antes de corrigir — e piscar branco na cara de
 * quem escolheu escuro é pior que não ter a opção.
 *
 * A lista de temas válidos é montada a partir de `TEMAS_ESCOLHIVEIS`, e não
 * escrita à mão aqui: um tema novo passa a ser aceito pelo script no mesmo
 * commit em que entra na lista. Valor desconhecido (chave de outra versão, ou
 * mexida à mão) é ignorado, e vale o tema do sistema.
 *
 * Falha calada de propósito: navegação privada pode recusar o localStorage, e
 * um erro aqui derrubaria o script inteiro (inclusive o data-js que segura as
 * animações de entrada). Sem escolha lida, vale o tema do sistema, que é o
 * comportamento certo mesmo.
 */
export const SCRIPT_TEMA =
  `try{var t=localStorage.getItem(${JSON.stringify(CHAVE_TEMA)});` +
  `if(${JSON.stringify([...TEMAS_ESCOLHIVEIS])}.indexOf(t)>=0)` +
  `document.documentElement.dataset.tema=t}catch(e){}`;
