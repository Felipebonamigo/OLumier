/**
 * Tema claro/escuro da interface — a chave e o script de arranque, num lugar só.
 *
 * Duas peças precisam concordar sobre onde a escolha fica guardada: o script
 * que roda antes da primeira pintura (em src/app/layout.tsx) e o botão que
 * grava a escolha (src/components/seletor-tema.tsx). Se cada um escrever a
 * string de novo, o dia em que a chave mudar de nome a pessoa escolhe o tema,
 * recarrega, e ele volta ao anterior — sem erro nenhum no console.
 *
 * Quem decide de fato qual tema vale é o CSS (src/app/globals.css): sem escolha
 * gravada, `color-scheme: light dark` segue o sistema de quem abriu. O
 * `data-tema` daqui só existe para TRAVAR um dos dois.
 */

export const CHAVE_TEMA = "olumier_tema";

export const TEMAS_ESCOLHIVEIS = ["claro", "escuro"] as const;
export type TemaEscolhido = (typeof TEMAS_ESCOLHIVEIS)[number];

/**
 * Roda antes da primeira pintura, direto no <head>.
 *
 * Precisa ser síncrono e minúsculo: qualquer coisa que espere o React deixaria
 * a página piscar no tema errado antes de corrigir — e piscar branco na cara de
 * quem escolheu escuro é pior que não ter a opção.
 *
 * Falha calada de propósito: navegação privada pode recusar o localStorage, e
 * um erro aqui derrubaria o script inteiro (inclusive o data-js que segura as
 * animações de entrada). Sem escolha lida, vale o tema do sistema, que é o
 * comportamento certo mesmo.
 */
export const SCRIPT_TEMA =
  `try{var t=localStorage.getItem(${JSON.stringify(CHAVE_TEMA)});` +
  `if(t==="claro"||t==="escuro")document.documentElement.dataset.tema=t}catch(e){}`;
