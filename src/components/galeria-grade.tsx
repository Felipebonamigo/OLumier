"use client";

import type { CSSProperties, ReactNode } from "react";
import { DENSIDADES, type Aparencia } from "@/config/aparencia";

/**
 * As quatro grades.
 *
 * "colunas" e "linhas" preservam o enquadramento original (nada é cortado) — é o
 * que fotógrafo pede primeiro. "quadrada" e "editorial" cortam de propósito, em
 * troca de ritmo visual.
 *
 * A responsividade sai de largura MÍNIMA por foto (column-width / auto-fill), não
 * de media queries: a grade se adapta sozinha de um celular estreito a um monitor
 * largo, e a densidade escolhida só muda essa largura.
 */

/** Largura-alvo de cada foto. Menor = mais fotos por tela. */
const LARGURA: Record<Aparencia["densidade"], number> = {
  compacta: 170,
  normal: 230,
  arejada: 320,
};

export function GaleriaGrade({
  aparencia,
  quantidade,
  render,
  proporcao,
}: {
  aparencia: Aparencia;
  quantidade: number;
  /** desenha o item i; recebe o estilo que o layout exige */
  render: (i: number, estilo: CSSProperties, classe: string) => ReactNode;
  /** largura/altura do item i — o layout de linhas precisa para justificar */
  proporcao: (i: number) => number;
}) {
  const { gap } = DENSIDADES[aparencia.densidade];
  const largura = LARGURA[aparencia.densidade];
  const itens = Array.from({ length: quantidade }, (_, i) => i);

  // COLUNAS — mural. CSS columns resolve sem JavaScript e sem saltos de layout.
  if (aparencia.grade === "colunas") {
    return (
      <div style={{ columnWidth: `${largura}px`, columnGap: gap }}>
        {itens.map((i) => render(i, { marginBottom: gap, breakInside: "avoid" }, "block w-full"))}
      </div>
    );
  }

  // LINHAS — fileiras justificadas. O flex-grow proporcional à largura da foto
  // faz cada fileira preencher a linha inteira sem cortar nada.
  if (aparencia.grade === "linhas") {
    const altura = Math.round(largura * 0.85);
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap }}>
        {itens.map((i) => {
          const p = proporcao(i);
          return render(
            i,
            { flexGrow: p, flexBasis: `${p * altura}px`, height: `${altura}px` },
            "block",
          );
        })}
      </div>
    );
  }

  // QUADRADA — tudo igual, ritmo de mosaico.
  if (aparencia.grade === "quadrada") {
    return (
      <div
        style={{
          display: "grid",
          gap,
          gridTemplateColumns: `repeat(auto-fill, minmax(min(${largura}px, 100%), 1fr))`,
        }}
      >
        {itens.map((i) => render(i, { aspectRatio: "1 / 1" }, "block w-full"))}
      </div>
    );
  }

  // EDITORIAL — a cada 5 fotos, uma ganha o dobro de espaço. Cria destaque e
  // respiro sem o fotógrafo precisar escolher nada.
  return (
    <div
      style={{
        display: "grid",
        gap,
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${largura}px, 100%), 1fr))`,
        gridAutoRows: `${Math.round(largura * 1.25)}px`,
      }}
    >
      {itens.map((i) => {
        const destaque = i % 5 === 0;
        return render(
          i,
          destaque
            ? { gridColumn: "span 2", gridRow: "span 2" }
            : {},
          "block h-full w-full",
        );
      })}
    </div>
  );
}
