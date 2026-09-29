/**
 * TROCAR DE PLATAFORMA SEM RECARREGAR A OUTRA ABA.
 *
 * O seletor "Galeria Átomo | Atomatiza" abria o outro produto com um link de
 * `target` nomeado. O nome fazia o clique cair na aba que já existia, mas o
 * link também MANDAVA essa aba carregar o endereço de novo: a pessoa voltava
 * para o Atomatiza e via a tela recarregar duas vezes (o `/login` de lá, e o
 * redirecionamento para o painel), perdendo onde estava. Felipe, 29/09/2026:
 * "vai para a outra aba e dá uma bugada recarregando".
 *
 * Agora o clique pergunta ao navegador pela aba antes de navegar:
 *
 *   · `window.open("", nome)` devolve a aba com esse nome SEM navegar nela, ou
 *     abre uma aba em branco se ela não existe;
 *   · aba em branco → é a primeira vez: leva ao endereço;
 *   · aba que não dá para ler (`location` de outra origem lança) → ela já está
 *     no outro produto: só traz para a frente, do jeito que ela estava.
 *
 * ── E SE O NAVEGADOR NÃO DEIXAR TRAZER PARA A FRENTE ─────────────────────
 *
 * `focus()` numa aba vizinha é pedido, não ordem: há navegador e configuração
 * que ignoram. Se, um instante depois, esta aba continua com o foco, o pedido
 * não foi atendido — e aí vale o caminho antigo (o link nomeado), que troca de
 * aba em todo lugar, ao preço de recarregar. Pior caso = o comportamento de
 * antes, nunca um clique que não faz nada.
 *
 * Clique com Ctrl/Cmd/Shift ou do meio segue sendo do navegador: quem pede aba
 * nova recebe aba nova.
 *
 * Cópia idêntica em `src/lib/aba-nomeada.ts` do Atomatiza — mudou aqui, mude lá.
 */

/** Quanto esperar para saber se a outra aba veio para a frente. */
const ESPERA_DO_FOCO_MS = 250;

/** O que o clique precisa ter — serve para o evento do React e o do DOM. */
type Clique = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  preventDefault(): void;
};

export function irParaAba(evento: Clique, url: string, nome: string) {
  if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;

  let aba: Window | null = null;
  try {
    aba = window.open("", nome);
  } catch {
    return; // sem janela nenhuma: o link segue sozinho
  }
  if (!aba) return; // bloqueado: o link segue sozinho
  evento.preventDefault();

  let jaEstaLa = false;
  try {
    // Mesma origem: é a aba em branco que acabou de nascer, ou a aba com esse
    // nome voltou a este site. Nos dois casos, leva ao endereço.
    void aba.location.href;
  } catch {
    // Outra origem: a aba já está no outro produto.
    jaEstaLa = true;
  }

  if (!jaEstaLa) {
    aba.location.href = url;
    aba.focus();
    return;
  }

  aba.focus();
  window.setTimeout(() => {
    if (!document.hasFocus()) return; // trocou de aba: pronto
    const link = document.createElement("a");
    link.href = url;
    link.target = nome;
    link.click();
  }, ESPERA_DO_FOCO_MS);
}
