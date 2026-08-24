"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Entrada suave no scroll — a peça de movimento da página institucional.
 *
 * IntersectionObserver + uma classe CSS, sem biblioteca. GSAP faria o mesmo ao
 * custo de uma dependência inteira para animar opacidade e translate; a regra
 * do projeto é subir a escada só até o degrau que resolve. O efeito respeita
 * `prefers-reduced-motion` no CSS (ver globals.css) — quem pediu menos
 * movimento recebe a página parada, sem JavaScript envolvido na decisão.
 *
 * Client component de folha: os filhos continuam renderizados no servidor.
 */
export function Revelar({
  children,
  className = "",
  atraso = 0,
}: {
  children: ReactNode;
  className?: string;
  /** ms de atraso — escalona irmãos sem precisar de timeline. */
  atraso?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Navegador sem IntersectionObserver não existe mais na prática, mas se
    // existir, a página aparece inteira em vez de ficar escondida pra sempre.
    if (!("IntersectionObserver" in window)) {
      el.setAttribute("data-visivel", "");
      return;
    }
    const io = new IntersectionObserver(
      ([entrada]) => {
        if (entrada.isIntersecting) {
          el.setAttribute("data-visivel", "");
          io.disconnect();
        }
      },
      // Dispara um pouco antes de entrar por inteiro: ninguém deve ver a página "vazia".
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`revelar ${className}`}
      style={atraso ? { transitionDelay: `${atraso}ms` } : undefined}
    >
      {children}
    </div>
  );
}
