"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DENSIDADES, LARGURA_DA_FOTO, type Aparencia } from "@/config/aparencia";
import { agruparEmFileiras, colunasDaGrade } from "@/lib/grade-mural";

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
  /*
   * A LARGURA MEDIDA sai junto desde 16/09/2026, para o panorama.
   *
   * O mural só precisa do NÚMERO de colunas — o flex reparte a largura sozinho.
   * A fileira justificada precisa da largura em pixels: a altura de cada
   * fileira é `largura útil ÷ soma das proporções`, e sem o número não há
   * conta. Zero é o valor antes da medição, e quem lê trata como "ainda não
   * sei" em vez de dividir por ele.
   */
  const [larguraMedida, setLarguraMedida] = useState(0);

  useEfeitoDeLayout(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      setColunas(colunasDaGrade(el.clientWidth, largura, gap, minColunas, maxColunas));
      setLarguraMedida(el.clientWidth);
    };
    medir();
    /* Redimensionar a janela, girar o celular, abrir o painel lateral — todos
       mudam a largura sem passar por nenhuma prop. */
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [largura, gap, minColunas, maxColunas]);

  return [ref, colunas, larguraMedida] as const;
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
 * PANORAMA — fileiras justificadas, com a foto deitada valendo por duas.
 *
 * Diferente do editorial, que promove uma a cada cinco sem olhar para a foto:
 * aqui quem decide é a própria imagem. Paisagem, mesa de festa, foto de drone —
 * o enquadramento que o fotógrafo escolheu horizontal aparece horizontal.
 *
 * ── POR QUE DEIXOU DE SER UMA GRADE DE CSS (16/09/2026) ──────────────────
 *
 * Felipe: "na panorama, a foto não está bem encaixada nos limites, a segunda
 * foto da esquerda pra direita fica um espaço grande em branco".
 *
 * Era `grid` com linhas de altura fixa e cada foto ocupando duas. Essa caixa só
 * fecha certo para UMA proporção — retrato 2:3. Foto quadrada desenhava a
 * largura inteira e dois terços da altura, e o terço restante era o branco da
 * foto dele. Pior: quando a deitada pedia duas colunas com só uma sobrando, o
 * CSS a empurrava para a fileira seguinte e deixava o vão para trás.
 *
 * A fileira justificada resolve os dois de uma vez, e é a matemática que todo
 * mural de fotografia usa: dada a largura da tela, a altura da fileira é
 * `largura útil ÷ soma das proporções`. Nessa altura, as larguras naturais das
 * fotos somam exatamente a largura disponível — não sobra vão, e nada é
 * cortado, que é a promessa desta grade.
 *
 * A ÚLTIMA FILEIRA é a exceção e continua com a altura das anteriores: uma
 * fileira com duas fotos esticadas até a borda desenharia duas fotos gigantes
 * no fim da galeria. Ela fica alinhada à esquerda, como num texto.
 *
 * ── E TAMBÉM A GRADE "COLUNAS" (26/09/2026) ─────────────────────────────
 *
 * Felipe, depois de quatro queixas do Juan sobre a ordem: "não pode trocar,
 * ele tem que seguir a ordem". O mural de colunas não tinha como — ver o
 * comentário de `lib/grade-mural.ts`. A "Colunas" passou a ser este mesmo
 * componente com `deitadaValeDuas={false}`: cada fileira tem exatamente o
 * número de fotos que a densidade dá de colunas.
 */
function Fileiras({
  quantidade,
  render,
  proporcao,
  largura,
  gap,
  minColunas,
  maxColunas,
  deitadaValeDuas,
}: Omit<PropsGrade, "aparencia"> & LimitesDaGrade & { deitadaValeDuas: boolean }) {
  const [ref, colunas, larguraMedida] = useColunas(largura, gap, minColunas, maxColunas);
  const proporcoes = Array.from({ length: quantidade }, (_, i) => {
    const p = proporcao(i);
    /* Proporção inválida viraria divisão por zero e uma fileira de altura
       infinita. 4/5 é o mesmo palpite que a galeria usa quando o banco não sabe
       o tamanho da foto. */
    return Number.isFinite(p) && p > 0 ? p : 4 / 5;
  });
  const fileiras = agruparEmFileiras(proporcoes, colunas, deitadaValeDuas);

  /* Antes de medir, a largura é 0 e não há conta a fazer: o primeiro quadro
     desenha uma coluna, que é o que o servidor manda e o que o celular recebe.
     `alturaBase` é a reserva para esse instante e para a última fileira. */
  const alturaBase = Math.round(largura * 1.25);

  return (
    <div ref={ref} style={{ display: "flex", flexDirection: "column", gap }}>
      {fileiras.map((indices, f) => {
        const soma = indices.reduce((t, i) => t + proporcoes[i], 0);
        const util = larguraMedida - gap * (indices.length - 1);
        /* A última fileira quase nunca tem fotos suficientes para preencher a
           largura. Esticá-la até a borda é o erro clássico do mural
           justificado: as duas últimas fotos da galeria saem do tamanho de um
           pôster. Ela mantém a altura das outras e sobra espaço à direita. */
        const ultimaIncompleta = f === fileiras.length - 1 && fileiras.length > 1;
        /*
         * Na "Colunas" a última fileira tem a altura que TERIA se estivesse
         * cheia — as fotos que faltam contadas pela média das que vieram. Com
         * N fotos por fileira essa conta existe (na Panorama não: não se sabe
         * quantas caberiam), e é ela que faz o fim da galeria ter o tamanho do
         * resto em vez do palpite fixo de `alturaBase`. Fileira que fechou
         * cheia é justificada como qualquer outra.
         */
        const alturaCheia =
          (larguraMedida - gap * (colunas - 1)) / ((soma * colunas) / indices.length);
        const alturaDaFileira =
          larguraMedida <= 0
            ? alturaBase
            : !ultimaIncompleta
              ? util / soma
              : deitadaValeDuas
                ? alturaBase
                : Math.min(alturaCheia, util / soma);

        return (
          <div key={f} style={{ display: "flex", gap }}>
            {indices.map((i) =>
              render(
                i,
                {
                  width: `${proporcoes[i] * alturaDaFileira}px`,
                  height: `${alturaDaFileira}px`,
                  /* Arredondamento de subpixel sobra ou falta um pixel na
                     ponta; encolher é invisível, transbordar quebra a fileira. */
                  flexShrink: 1,
                  minWidth: 0,
                },
                "block h-full w-full",
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}

export function GaleriaGrade({ aparencia, quantidade, render, proporcao }: PropsGrade) {
  const { gapPx: gap, minColunas, maxColunas } = DENSIDADES[aparencia.densidade];
  const largura = LARGURA_DA_FOTO[aparencia.densidade];
  const itens = Array.from({ length: quantidade }, (_, i) => i);

  /* "Colunas" e "Panorama" são o mesmo desenho — fileiras justificadas, na
     ordem, sem cortar nada —, e diferem na conta da fileira. Ver `Fileiras`. */
  if (aparencia.grade === "colunas" || aparencia.grade === "panorama") {
    return (
      <Fileiras
        quantidade={quantidade}
        render={render}
        proporcao={proporcao}
        largura={largura}
        gap={gap}
        minColunas={minColunas}
        maxColunas={maxColunas}
        deitadaValeDuas={aparencia.grade === "panorama"}
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
