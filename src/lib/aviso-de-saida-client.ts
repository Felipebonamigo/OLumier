"use client";

import { useEffect } from "react";

/**
 * AVISAR ANTES DE SAIR, quando sair custa trabalho.
 *
 * ── O PEDIDO (16/09/2026) ─────────────────────────────────────────────────
 *
 * Felipe: "ao sair dessa última página, ele avisa se pode sair ou não". E, ao
 * ser perguntado de qual das duas telas falava — a de envio ou a de Design —:
 * "as duas".
 *
 * ── O QUE JÁ EXISTIA, E O BURACO QUE SOBRAVA ─────────────────────────────
 *
 * As duas telas já ouviam `beforeunload`, então fechar a aba ou recarregar já
 * perguntava. O que nenhuma das duas cobria é o gesto mais comum dentro do
 * produto: clicar em "← Galerias", ou trocar de aba pelo menu da esquerda.
 *
 * Navegação do App Router não recarrega a página — ela troca componentes. O
 * navegador não considera isso "sair", e `beforeunload` simplesmente não
 * dispara. Quem estava enviando 600 fotos via a fila morrer em silêncio.
 *
 * ── POR QUE UM OUVINTE DE CLIQUE, E NÃO `onNavigate` NO LINK ──────────────
 *
 * O `<Link>` do Next tem `onNavigate`, que aceita `preventDefault()`. Ele
 * resolve um link de cada vez — e o que precisa de guarda aqui são TODOS: o
 * menu lateral, a migalha do topo, o cabeçalho, e o próximo link que alguém
 * escrever sem saber que esta regra existe. Guarda que depende de lembrar não
 * é guarda.
 *
 * O ouvinte é de CAPTURA e mora no documento, então roda antes do React
 * despachar o clique — `preventDefault` ali impede a navegação de começar.
 *
 * ── O QUE ISTO NÃO COBRE, DE PROPÓSITO ───────────────────────────────────
 *
 * O botão VOLTAR do navegador. Segurá-lo exige empurrar uma entrada falsa no
 * histórico e desfazê-la a cada `popstate` — um truque que quebra o próprio
 * botão de voltar quando algo sai da ordem prevista. Entre avisar em 95% dos
 * gestos e ter um botão de voltar imprevisível em 100% das telas, a escolha é
 * a primeira. O `beforeunload` continua pegando o fechar e o recarregar.
 *
 * @param ativo  Só guarda quando há o que perder. Falso não instala nada.
 * @param mensagem O que se perde, em uma frase, para a pessoa decidir.
 */
export function useAvisoDeSaida(ativo: boolean, mensagem: string) {
  useEffect(() => {
    if (!ativo) return;

    /* Fechar a aba e recarregar. O texto é ignorado pelos navegadores desde
       2016 — todos mostram uma frase genérica —, mas `preventDefault()` é o
       que liga o diálogo, e sem ele não há pergunta nenhuma. */
    const aoDescarregar = (e: BeforeUnloadEvent) => e.preventDefault();

    const aoClicar = (e: MouseEvent) => {
      /* Clique com modificador abre em outra aba: esta aqui não vai a lugar
         nenhum, e não há o que perder. O mesmo vale para o botão do meio. */
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const alvo = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!alvo || alvo.target === "_blank" || alvo.hasAttribute("download")) return;

      const destino = new URL(alvo.href, window.location.href);
      /* Outro site sai pelo `beforeunload`, que já pergunta. Âncora para a
         mesma página (#fotos) não é saída. */
      if (destino.origin !== window.location.origin) return;
      if (destino.pathname === window.location.pathname) return;

      if (!window.confirm(mensagem)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", aoDescarregar);
    document.addEventListener("click", aoClicar, true);
    return () => {
      window.removeEventListener("beforeunload", aoDescarregar);
      document.removeEventListener("click", aoClicar, true);
    };
  }, [ativo, mensagem]);
}
