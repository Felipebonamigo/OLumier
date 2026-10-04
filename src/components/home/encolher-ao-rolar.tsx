"use client";

import { useEffect } from "react";

/**
 * O CABEÇALHO DA HOME ENCOLHE QUANDO A PÁGINA ROLA (03/10/2026).
 *
 * O `<header>` continua no servidor, em `app/page.tsx` — é lá que o
 * `testar-tema` confere que ele tem fundo próprio. Este componente só marca
 * `data-encolhido` nele quando a página passa do topo; o desenho da pílula
 * encolhida mora em `.home-topo` (globals.css). Uma leitura de `scrollY` por
 * quadro, no máximo.
 */
export function EncolherAoRolar({ alvo }: { alvo: string }) {
  useEffect(() => {
    const el = document.getElementById(alvo);
    if (!el) return;
    let agendado = false;
    const medir = () => {
      agendado = false;
      el.toggleAttribute("data-encolhido", window.scrollY > 48);
    };
    const aoRolar = () => {
      if (agendado) return;
      agendado = true;
      requestAnimationFrame(medir);
    };
    medir();
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, [alvo]);
  return null;
}
