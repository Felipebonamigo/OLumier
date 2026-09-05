"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DENSIDADES, LARGURA_DA_FOTO, type Aparencia } from "@/config/aparencia";
import { colunasDaGrade, colunasDoItem, distribuirEmColunas } from "@/lib/grade-mural";

/**
 * As cinco grades.
 *
 * "colunas", "linhas" e "panorama" preservam o enquadramento original (nada é
 * cortado) — é o que fotógrafo pede primeiro. "quadrada" e "editorial" cortam
 * de propósito, em troca de ritmo visual.
 *
 * A responsividade sai de largura MÍNIMA por foto, não de media queries: a
 * grade se adapta sozinha de um celular estreito a um monitor largo, e a
 * densidade escolhida só muda essa largura.
 */

/**
 * `useLayoutEffect` no navegador, `useEffect` no servidor.
 *
 * A medição TEM de acontecer antes da primeira pintura: o primeiro quadro é
 * desenhado com uma coluna (é o que o servidor manda, e o que o celular recebe
 * de qualquer jeito), e num computador ele vira quatro. Com `useEffect` esse
 * salto aconteceria DEPOIS de pintar, e a pessoa veria a galeria montar em
 * coluna única e reorganizar na frente dela.
 *
 * A troca existe porque `useLayoutEffect` avisa no console quando roda na
 * renderização do servidor — onde não há layout para medir. É o padrão
 * isomórfico de sempre, e a escolha é feita uma vez, no módulo, não a cada
 * render.
 */
/** A densidade traduzida em números: largura-alvo, respiro, piso e teto. */
interface LimitesDaGrade {
  largura: number;
  gap: number;
  minColunas: number;
  maxColunas: number;
}

const useEfeitoDeLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Quantas colunas cabem AGORA, medindo o container de verdade.
 *
 * Devolve a referência para pendurar no elemento e o número de colunas. Começa
 * em 1 de propósito: é o que o HTML do servidor desenha, então a hidratação
 * bate, e é o valor certo para o celular.
 */
function useColunas(largura: number, gap: number, minColunas: number, maxColunas: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [colunas, setColunas] = useState(1);

  useEfeitoDeLayout(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () =>
      setColunas(colunasDaGrade(el.clientWidth, largura, gap, minColunas, maxColunas));
    medir();
    /* Redimensionar a janela, girar o celular, abrir o painel lateral — todos
       mudam a largura sem passar por nenhuma prop. */
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [largura, gap]);

  return [ref, colunas] as const;
}

interface PropsGrade {
  aparencia: Aparencia;
  quantidade: number;
  /** desenha o item i; recebe o estilo que o layout exige */
  render: (i: number, estilo: CSSProperties, classe: string) => ReactNode;
  /** largura/altura do item i — os layouts de linhas e panorama precisam */
  proporcao: (i: number) => number;
}

/**
 * MURAL — alturas variadas, ordem de LEITURA.
 *
 * Era `column-width` do CSS, que preenche uma coluna inteira antes de começar
 * a próxima: com 30 fotos em 3 colunas, a foto 21 aparecia no topo da terceira.
 * O sócio descreveu como "fotos do fim aparecerem bem em cima" — e não havia
 * como corrigir só com CSS, porque quem decide quantas fotos cabem por coluna é
 * o motor de multi-column, e ele não conta para ninguém. Ver `lib/grade-mural.ts`.
 */
function Mural({
  quantidade,
  render,
  largura,
  gap,
  minColunas,
  maxColunas,
}: Omit<PropsGrade, "aparencia" | "proporcao"> & LimitesDaGrade) {
  const [ref, colunas] = useColunas(largura, gap, minColunas, maxColunas);
  const distribuicao = distribuirEmColunas(quantidade, colunas);

  return (
    <div ref={ref} style={{ display: "flex", gap, alignItems: "flex-start" }}>
      {distribuicao.map((indices, c) => (
        <div
          key={c}
          /* `minWidth: 0` porque item de flex não encolhe abaixo do conteúdo por
             padrão — sem isso, uma foto larga empurra a coluna e estoura a linha. */
          style={{ display: "flex", flexDirection: "column", gap, flex: "1 1 0", minWidth: 0 }}
        >
          {indices.map((i) => render(i, {}, "block w-full"))}
        </div>
      ))}
    </div>
  );
}

/**
 * PANORAMA — a foto deitada ocupa o dobro da largura.
 *
 * Diferente do editorial, que promove uma a cada cinco sem olhar para a foto:
 * aqui quem decide é a própria imagem. Paisagem, mesa de festa, foto de drone
 * — o enquadramento que o fotógrafo escolheu horizontal aparece horizontal.
 *
 * As colunas são declaradas com número EXATO (`repeat(n, ...)`) e não com
 * `auto-fill`: o JavaScript precisa saber quantas são para decidir quem ocupa
 * duas, e duas fontes de verdade para o mesmo número acabariam discordando
 * justamente na largura em que o layout quebra.
 */
function Panorama({
  quantidade,
  render,
  proporcao,
  largura,
  gap,
  minColunas,
  maxColunas,
}: Omit<PropsGrade, "aparencia"> & LimitesDaGrade) {
  const [ref, colunas] = useColunas(largura, gap, minColunas, maxColunas);
  const itens = Array.from({ length: quantidade }, (_, i) => i);

  return (
    <div
      ref={ref}
      style={{
        display: "grid",
        gap,
        gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))`,
        /* Duas fileiras por foto: a altura fica ~1,5× a largura de uma coluna,
           que é a caixa de um retrato 2:3. A deitada usa a mesma altura e o
           dobro da largura. */
        gridAutoRows: `${Math.round(largura * 0.75)}px`,
      }}
    >
      {itens.map((i) =>
        render(
          i,
          {
            gridColumn: `span ${colunasDoItem(proporcao(i), colunas)}`,
            gridRow: "span 2",
          },
          "block h-full w-full",
        ),
      )}
    </div>
  );
}

export function GaleriaGrade({ aparencia, quantidade, render, proporcao }: PropsGrade) {
  const { gapPx: gap, minColunas, maxColunas } = DENSIDADES[aparencia.densidade];
  const largura = LARGURA_DA_FOTO[aparencia.densidade];
  const itens = Array.from({ length: quantidade }, (_, i) => i);

  if (aparencia.grade === "colunas") {
    return (
      <Mural
        quantidade={quantidade}
        render={render}
        largura={largura}
        gap={gap}
        minColunas={minColunas}
        maxColunas={maxColunas}
      />
    );
  }

  if (aparencia.grade === "panorama") {
    return (
      <Panorama
        quantidade={quantidade}
        render={render}
        proporcao={proporcao}
        largura={largura}
        gap={gap}
        minColunas={minColunas}
        maxColunas={maxColunas}
      />
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
          destaque ? { gridColumn: "span 2", gridRow: "span 2" } : {},
          "block h-full w-full",
        );
      })}
    </div>
  );
}
