"use client";

import type { ReactNode } from "react";
import { verNaGrade, type FiltroDaGrade } from "@/lib/filtro-da-grade";

/**
 * Um botão que mostra um recorte na grade da aba e leva a tela até ela. Existe
 * para quem está FORA da grade (o aviso de repetidas, que é do servidor)
 * poder apontar para ela. Ver `lib/filtro-da-grade.ts`.
 */
export function VerNaGrade({
  galeriaId,
  filtro,
  className,
  children,
}: {
  galeriaId: string;
  filtro: FiltroDaGrade;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={() => verNaGrade(galeriaId, filtro)} className={className}>
      {children}
    </button>
  );
}
