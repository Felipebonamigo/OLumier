"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DENSIDADES, LARGURA_DA_FOTO, type Aparencia } from "@/config/aparencia";
import {
  agruparEmFileiras,
  colunasDaGrade,
  fileiraChegaNaBorda,
  fileirasDeColunas,
  fileirasPorAltura,
} from "@/lib/grade-mural";

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
   * A LARGURA MEDIDA sai junto desde 16/09/2026, para o panorama — e, desde
   * 26/09/2026, também para a "Colunas", que virou fileira justificada.
   *
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
  /**
   * Não vem mais foto depois destas? Na galeria fatiada o resto chega rolando,
   * e enquanto chega a "Colunas" não reparte o fim — ver `fileirasDeColunas`.
   * Sem fatia, a lista já é a inteira.
   */
  listaCompleta?: boolean;
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
 * componente: cada fileira tem exatamente o número de fotos que a densidade
 * dá de colunas.
 *
 * ── E A "LINHAS" (28/09/2026) ───────────────────────────────────────────
 *
 * Era `flex-wrap` com `flex-grow`, e a foto vertical sozinha numa linha
 * crescia só dois terços da sobra — a barra branca do print do Felipe. Ver
 * `fileirasPorAltura`. Aqui as fileiras saem na altura-alvo da densidade,
 * justificadas até a borda como as das outras duas.
 */
function Fileiras({
  quantidade,
  render,
  proporcao,
  largura,
  gap,
  minColunas,
  maxColunas,
  modo,
  listaCompleta = true,
}: Omit<PropsGrade, "aparencia"> & LimitesDaGrade & { modo: "colunas" | "panorama" | "linhas" }) {
  const [ref, colunas, larguraMedida] = useColunas(largura, gap, minColunas, maxColunas);
  const proporcoes = Array.from({ length: quantidade }, (_, i) => {
    const p = proporcao(i);
    /* Proporção inválida viraria divisão por zero e uma fileira de altura
       infinita. 4/5 é o mesmo palpite que a galeria usa quando o banco não sabe
       o tamanho da foto. */
    return Number.isFinite(p) && p > 0 ? p : 4 / 5;
  });
  const deitadaValeDuas = modo === "panorama";
  /* A altura-alvo da "Linhas" — a mesma de antes, quando ela era `flex-wrap`. */
  const alturaAlvo = Math.round(largura * 0.85);
  const porAltura =
    modo === "linhas"
      ? fileirasPorAltura(proporcoes, larguraMedida, alturaAlvo, gap, listaCompleta)
      : null;
  const fileiras = porAltura
    ? porAltura.fileiras
    : deitadaValeDuas
      ? agruparEmFileiras(proporcoes, colunas)
      : fileirasDeColunas(quantidade, colunas, listaCompleta);

  /* Antes de medir, a largura é 0 e não há conta a fazer: o primeiro quadro
     desenha uma coluna, que é o que o servidor manda e o que o celular recebe.
     `alturaBase` é a reserva para esse instante e para a última fileira. */
  const alturaBase = Math.round(largura * 1.25);

  return (
    <div ref={ref} data-grade={modo} style={{ display: "flex", flexDirection: "column", gap }}>
      {fileiras.map((indices, f) => {
        const soma = indices.reduce((t, i) => t + proporcoes[i], 0);
        const util = larguraMedida - gap * (indices.length - 1);
        /* A última fileira quase nunca tem fotos suficientes para preencher a
           largura. Esticá-la até a borda é o erro clássico do mural
           justificado: as duas últimas fotos da galeria saem do tamanho de um
           pôster. Ela mantém a altura das outras e sobra espaço à direita. */
        const ultimaIncompleta = f === fileiras.length - 1 && fileiras.length > 1;
        /*
         * Na "Colunas" toda fileira chega à borda: `fileirasDeColunas` já
         * repartiu o fim para nenhuma sair curta (26/09/2026 — "tente deixar
         * sem espaçamento"). As exceções estão em `fileiraChegaNaBorda` — o
         * fim de um lote que ainda chega rolando, e o capítulo de uma ou duas
         * fotos. Essas saem com a altura que TERIAM cheias — as fotos que
         * faltam contadas pela média das que vieram — em vez de esticar
         * poucas fotos até a borda.
         */
        const alturaCheia =
          (larguraMedida - gap * (colunas - 1)) / ((soma * colunas) / indices.length);
        /* Na "Linhas" toda fileira é justificada, menos a última quando
           `fileirasPorAltura` decidiu que ela fica na altura-alvo. */
        const alturaDaFileira =
          porAltura
            ? larguraMedida > 0 && (f < fileiras.length - 1 || porAltura.ultimaEstica)
              ? util / soma
              : alturaAlvo
          : larguraMedida <= 0
            ? alturaBase
            : deitadaValeDuas
              ? ultimaIncompleta
                ? alturaBase
                : util / soma
              : fileiraChegaNaBorda(indices.length, colunas, listaCompleta)
                ? util / soma
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

export function GaleriaGrade({
  aparencia,
  quantidade,
  render,
  proporcao,
  listaCompleta = true,
}: PropsGrade) {
  const { gapPx: gap, minColunas, maxColunas } = DENSIDADES[aparencia.densidade];
  const largura = LARGURA_DA_FOTO[aparencia.densidade];
  const itens = Array.from({ length: quantidade }, (_, i) => i);

  /* "Colunas", "Panorama" e "Linhas" são o mesmo desenho — fileiras
     justificadas, na ordem, sem cortar nada —, e diferem na conta da fileira.
     Ver `Fileiras`. */
  if (aparencia.grade === "colunas" || aparencia.grade === "panorama" || aparencia.grade === "linhas") {
    return (
      <Fileiras
        quantidade={quantidade}
        render={render}
        proporcao={proporcao}
        largura={largura}
        gap={gap}
        minColunas={minColunas}
        maxColunas={maxColunas}
        modo={aparencia.grade}
        listaCompleta={listaCompleta}
      />
    );
  }

  // QUADRADA — tudo igual, ritmo de mosaico.
  if (aparencia.grade === "quadrada") {
    return (
      <div
        data-grade="quadrada"
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
      data-grade="editorial"
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
