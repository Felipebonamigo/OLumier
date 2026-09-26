"use client";

import { useSyncExternalStore } from "react";

/*
 * A tela é de celular? Pela mesma fronteira do Tailwind (`md` = 768 px).
 *
 * As galerias de demonstração da home são desenhadas numa "tela virtual" e
 * reduzidas em escala. A capa decide o próprio layout por media query — que
 * olha a janela DE VERDADE —, então a tela virtual precisa estar do mesmo lado
 * da fronteira: janela de celular, galeria de celular (390 px); janela de
 * computador, galeria de computador. Uma capa de celular esticada em 1200 px
 * não é nenhuma das duas.
 *
 * No servidor não há janela: responde "computador", e a moldura fica
 * invisível até medir (ver `GaleriaDemo`), então o celular nunca vê a troca.
 */
const CONSULTA = "(max-width: 767px)";

function assinar(avisar: () => void) {
  const m = window.matchMedia(CONSULTA);
  m.addEventListener("change", avisar);
  return () => m.removeEventListener("change", avisar);
}

export function useEhCelular(): boolean {
  return useSyncExternalStore(
    assinar,
    () => window.matchMedia(CONSULTA).matches,
    () => false,
  );
}

/* Quem pediu menos movimento no sistema — para as rotações automáticas. */
const MENOS_MOVIMENTO = "(prefers-reduced-motion: reduce)";

function assinarMovimento(avisar: () => void) {
  const m = window.matchMedia(MENOS_MOVIMENTO);
  m.addEventListener("change", avisar);
  return () => m.removeEventListener("change", avisar);
}

export function usePedeMenosMovimento(): boolean {
  return useSyncExternalStore(
    assinarMovimento,
    () => window.matchMedia(MENOS_MOVIMENTO).matches,
    () => true,
  );
}
