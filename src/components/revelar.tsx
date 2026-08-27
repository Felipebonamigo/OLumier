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
      /*
       * `threshold: 0` — e já foi 0.12, que era um defeito disfarçado de
       * capricho. Threshold é fração DO ELEMENTO: num elemento mais alto que a
       * janela (a seção de planos inteira, por exemplo), 12% dele pode nunca
       * caber na tela de uma vez, o limiar nunca dispara e o conteúdo fica em
       * opacity 0 PARA SEMPRE. Medido em 27/08/2026 numa janela de 713px: doze
       * dos trinta e três blocos da home invisíveis com a página parada no pé.
       *
       * Quem garante o "só revela quando está de fato entrando" é o rootMargin
       * negativo, que é fração da JANELA e não sofre do mesmo mal.
       */
      { threshold: 0, rootMargin: "0px 0px -8% 0px" },
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
