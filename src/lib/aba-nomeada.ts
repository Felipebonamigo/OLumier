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
 * Trazer uma aba vizinha para a frente é pedido, não ordem: há navegador e
 * configuração que ignoram. Se esta aba NÃO sai da frente, o pedido não foi
 * atendido — e aí vale o caminho antigo (o link nomeado), que troca de aba em
 * todo lugar, ao preço de recarregar. Pior caso = o comportamento de antes,
 * nunca um clique que não faz nada.
 *
 * "Sair da frente" é o navegador quem diz, por evento (`visibilitychange` para
 * oculta, ou `blur`), e não um relógio curto. A primeira versão olhava o foco
 * 250 ms depois do clique, e com os dois painéis de verdade a outra aba levava
 * mais que isso para aparecer: a conferência via esta aba ainda na frente,
 * achava que tinha falhado e recarregava a outra à toa — era a "recarga dupla"
 * que o Felipe viu no dia 29/09. Reproduzido no Chrome de verdade, com os dois
 * produtos no ar lado a lado, e corrigido aqui.
 *
 * Clique com Ctrl/Cmd/Shift ou do meio segue sendo do navegador: quem pede aba
 * nova recebe aba nova.
 *
 * Cópia idêntica em `src/lib/aba-nomeada.ts` do Atomatiza — mudou aqui, mude lá.
 */

/**
 * Até quando esperar o sinal de que a outra aba veio para a frente. É só o
 * teto do caso em que ela NÃO vem: quando vem, o sinal chega antes e nada
 * mais acontece.
 */
const ESPERA_MAXIMA_MS = 1500;

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

  let saiuDaFrente = false;
  const saiu = () => {
    saiuDaFrente = true;
  };
  const aoMudarVisibilidade = () => {
    if (document.visibilityState === "hidden") saiu();
  };
  document.addEventListener("visibilitychange", aoMudarVisibilidade);
  window.addEventListener("blur", saiu);

  window.setTimeout(() => {
    document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    window.removeEventListener("blur", saiu);
    if (saiuDaFrente || document.visibilityState === "hidden" || !document.hasFocus()) return; // trocou de aba
    const link = document.createElement("a");
    link.href = url;
    link.target = nome;
    link.click();
  }, ESPERA_MAXIMA_MS);
}
