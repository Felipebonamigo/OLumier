"use client";

import { useEffect } from "react";

/**
 * Tira da barra a âncora que só serviu para CHEGAR.
 *
 * As pastas e o stream levam a pessoa direto ao conteúdo com `#conteudo` e
 * `#pastas` — é o que pula a capa quando ela entra numa pasta ou volta para
 * a lista. Depois de rolar, a âncora não tem mais função, e ficaria no link
 * que o casal copia da barra: o mesmo "link cheio de coisa" que já fez o
 * capítulo sair da barra em 29/09/2026 (ver `galeria-cliente.tsx`).
 *
 * `replaceState` não rola a página de volta — a pessoa continua onde chegou.
 * Âncora que não é nossa (qualquer outra) fica onde está.
 */
const NOSSAS = new Set(["#conteudo", "#pastas"]);

export function AncoraDeChegada() {
  useEffect(() => {
    if (!NOSSAS.has(window.location.hash)) return;
    /* Um quadro depois: a rolagem até a âncora já aconteceu, e o Next já
       terminou de ajustar a barra da navegação. */
    const t = window.setTimeout(() => {
      if (!NOSSAS.has(window.location.hash)) return;
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    }, 300);
    return () => window.clearTimeout(t);
  });
  return null;
}
