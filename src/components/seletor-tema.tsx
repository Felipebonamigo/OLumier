"use client";

import { CHAVE_TEMA, type TemaEscolhido } from "@/config/tema";

/**
 * Troca entre claro e escuro, sem login.
 *
 * Não guarda estado em React de propósito. Quem desenha o tema é o CSS
 * (`color-scheme` + `light-dark()` em globals.css); aqui só gravamos a escolha
 * no <html> e no localStorage. Sem estado não há hidratação divergente e não há
 * o piscar clássico de tema — o servidor não sabe (nem pode saber) o que a
 * pessoa escolheu, então qualquer marca de estado no HTML entregue estaria
 * errada metade das vezes.
 *
 * Pelo mesmo motivo o ícone é fixo: um sol que vira lua precisaria saber o tema
 * atual na primeira pintura. O símbolo de contraste (círculo meio cheio) diz
 * "troca de tema" sem precisar dizer em qual você está — e isso a tela inteira
 * já está dizendo.
 */
export function SeletorTema({ className = "" }: { className?: string }) {
  function alternar() {
    const raiz = document.documentElement;

    // Sem escolha anterior, o "atual" é o que o sistema mandou — senão o
    // primeiro clique de quem está no claro por preferência do sistema não
    // faria nada visível (gravaria "claro" em cima de claro).
    const atual: TemaEscolhido =
      raiz.dataset.tema === "claro" || raiz.dataset.tema === "escuro"
        ? raiz.dataset.tema
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "escuro"
          : "claro";

    const novo: TemaEscolhido = atual === "escuro" ? "claro" : "escuro";
    raiz.dataset.tema = novo;

    try {
      localStorage.setItem(CHAVE_TEMA, novo);
    } catch {
      // Navegação privada pode recusar o armazenamento. A troca vale nesta aba
      // mesmo assim; só não sobrevive ao recarregar.
    }
  }

  return (
    <button
      type="button"
      onClick={alternar}
      title="Alternar entre tema claro e escuro"
      aria-label="Alternar entre tema claro e escuro"
      className={`grid h-9 w-9 place-items-center rounded-full border border-linha text-texto-soft transition hover:border-linha-forte hover:text-texto ${className}`}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
        {/* metade cheia: o mesmo círculo dos dois lados da luz */}
        <path d="M12 3 A9 9 0 0 1 12 21 Z" fill="currentColor" />
      </svg>
    </button>
  );
}
