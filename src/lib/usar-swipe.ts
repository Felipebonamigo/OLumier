"use client";

import { useRef, type TouchEvent } from "react";

/**
 * Swipe horizontal para trocar de foto no celular.
 *
 * Sem isso, o convidado tenta arrastar (o gesto que ele usa em qualquer app de
 * fotos), nada acontece, e ele conclui que a galeria travou. As setinhas na tela
 * continuam existindo — o swipe é adicional, não substituto.
 *
 * O nome começa com `use` sozinho no meio de um código em português porque o
 * prefixo é CONTRATO do React, não estilo: é por ele que o lint sabe que aqui
 * dentro pode haver hook e confere as regras. Chamado `usarSwipe`, o
 * `react-hooks/rules-of-hooks` desligava a conferência do arquivo inteiro.
 */
export function useSwipe(aoEsquerda: () => void, aoDireita: () => void) {
  const inicio = useRef<{ x: number; y: number } | null>(null);

  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      inicio.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd: (e: TouchEvent) => {
      if (!inicio.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - inicio.current.x;
      const dy = t.clientY - inicio.current.y;
      inicio.current = null;

      // Só conta como swipe se andou o bastante E foi mais horizontal que
      // vertical — senão rolar a página pelo lightbox trocaria de foto sem querer.
      const DISTANCIA_MINIMA = 50;
      if (Math.abs(dx) < DISTANCIA_MINIMA || Math.abs(dx) < Math.abs(dy)) return;

      if (dx < 0) aoEsquerda();
      else aoDireita();
    },
  };
}
