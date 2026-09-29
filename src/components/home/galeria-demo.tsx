"use client";
/* eslint-disable @next/next/no-img-element -- a mesma marcação de foto da grade
 * do cliente (`galeria-cliente.tsx`); `next/image` seria outra galeria. */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { GaleriaCapa } from "@/components/galeria-capa";
import { GaleriaGrade } from "@/components/galeria-grade";
import {
  FONTES_TEXTO,
  OPCOES,
  variaveisDeForma,
  variaveisDoTema,
  type Aparencia,
} from "@/config/aparencia";
import type { FotosDaHome, Identidade } from "@/config/home-demonstracao";
import { useEhCelular } from "./usa-celular";

/**
 * UMA GALERIA DE VERDADE, EM MINIATURA — a peça de que a home inteira é feita.
 *
 * ── NÃO É MOCKUP ──────────────────────────────────────────────────────────
 *
 * A capa é `GaleriaCapa` e a grade é `GaleriaGrade`: os mesmos componentes da
 * página que o cliente abre, com as mesmas variáveis de tema e de forma. O que
 * esta peça acrescenta é só a MOLDURA — desenha a galeria numa tela virtual e a
 * reduz em escala para caber onde a home precisar, do jeito que a prévia do
 * editor de Design já faz com o iframe.
 *
 * Por que não um iframe aqui também: são até sete galerias na página, e cada
 * iframe é um documento inteiro (HTML, CSS, fontes). Desenhadas no próprio
 * documento, elas dividem tudo isso e só as fotos descem.
 *
 * ── A TELA VIRTUAL ────────────────────────────────────────────────────────
 *
 * A capa escolhe o layout por media query — que olha a janela de verdade, não
 * a moldura. Por isso a tela virtual segue a janela: computador desenha em
 * 1200 px, celular em 390 px (ver `useEhCelular`). A altura da capa, que no
 * produto é `vh`, vira pixels da janela virtual pela variável `--g-capa-h`.
 *
 * Até medir a moldura, o conteúdo fica transparente: a escala depende da
 * largura, e desenhar antes seria mostrar a galeria no tamanho errado por um
 * quadro. A moldura em si tem tamanho do CSS de quem a usa, então nada pula.
 */

const LARGURA_VIRTUAL = { computador: 1200, celular: 390 } as const;
/* Altura da janela virtual — é contra ela que a capa calcula o seu `vh`. */
const JANELA_VIRTUAL = { computador: 800, celular: 780 } as const;

/* O mesmo contorno e a mesma sombra do coração da galeria do cliente
   (`galeria-cliente.tsx`). Copiados, e não importados, porque lá são internos
   ao componente — e a amostra precisa ser o mesmo desenho, não um parecido. */
const CORACAO = "M12 20.5 4.6 13a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9A4.6 4.6 0 0 1 19.4 13Z";
const GLIFO_SOBRE_FOTO =
  "drop-shadow(0 1px 1.5px rgba(0,0,0,.85)) drop-shadow(0 0 6px rgba(0,0,0,.45))";

export function GaleriaDemo({
  identidade,
  fotos: fotosDaHome,
  aparencia,
  className = "",
  carregarAgora = false,
  semCapa = false,
  rolar = 0,
  favoritas,
  ultimaMarcada,
}: {
  identidade: Identidade;
  /**
   * As fotos de cada lugar — o padrão com as trocas do admin por cima, lidas
   * no servidor por `fotosDaHome()`. Chegam por parâmetro, e não por import,
   * porque mudam sem publicar código.
   */
  fotos: FotosDaHome;
  /** Troca a aparência da identidade — é o que a seção "Sua marca" usa. */
  aparencia?: Aparencia;
  /** Classe da MOLDURA: é ela que decide largura e altura na home. */
  className?: string;
  /** As primeiras fotos sem `lazy` — só para a galeria que abre a página. */
  carregarAgora?: boolean;
  semCapa?: boolean;
  /** Quanto da galeria já "rolou", em pixels da tela virtual. */
  rolar?: number;
  /** Índices das fotos marcadas. Com a lista, os corações aparecem. */
  favoritas?: number[];
  /** A última marcada pulsa — é o gesto que a seção de seleção mostra. */
  ultimaMarcada?: number | null;
}) {
  const celular = useEhCelular();
  const tela = celular ? "celular" : "computador";
  const largura = LARGURA_VIRTUAL[tela];

  const moldura = useRef<HTMLDivElement>(null);
  const [medida, setMedida] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = moldura.current;
    if (!el) return;
    const observador = new ResizeObserver(([e]) => {
      setMedida({ w: e.contentRect.width, h: e.contentRect.height });
    });
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  const escala = medida && medida.w > 0 ? medida.w / largura : 1;
  const alturaVirtual = medida ? medida.h / escala : JANELA_VIRTUAL[tela];

  const ap = aparencia ?? identidade.aparencia;
  const vh = OPCOES.alturaCapa.find((o) => o.id === ap.alturaCapa)?.vh ?? 60;
  const capa = fotosDaHome[identidade.capa];
  /* As fotos de exemplo acabam antes da moldura: a grade de verdade de um
     casamento tem centenas. Repetidas numa ordem diferente, a moldura se enche.

     A segunda volta é a das posições ímpares e depois a das pares — e não a
     lista ao contrário, como era: ao contrário, a última foto da primeira volta
     é a primeira da segunda, e as duas saíam lado a lado (com as 14 fotos da
     Vanessa & Kalil, bem no meio da seleção). Assim a mesma foto fica a pelo
     menos meia galeria de distância dela mesma. */
  const segundaVolta = [
    ...identidade.fotos.filter((_, i) => i % 2 === 1),
    ...identidade.fotos.filter((_, i) => i % 2 === 0),
  ];
  const ids = [...identidade.fotos, ...segundaVolta];
  const fotos = ids.map((id) => fotosDaHome[id]);

  const alturaPeloLayout = ap.grade === "linhas" || ap.grade === "editorial";
  const cobre = alturaPeloLayout || ap.grade === "quadrada";

  const tela_: CSSProperties = {
    ...variaveisDoTema(ap),
    ...variaveisDeForma(ap),
    ["--g-capa-h" as string]: `${Math.round((JANELA_VIRTUAL[tela] * vh) / 100)}px`,
    width: largura,
    height: alturaVirtual,
    transform: `scale(${escala})`,
    transformOrigin: "top left",
    background: "var(--g-fundo)",
    color: "var(--g-texto)",
    fontFamily: FONTES_TEXTO[ap.fonteTexto],
    opacity: medida ? 1 : 0,
    transition: "opacity .4s ease",
  };

  return (
    <div ref={moldura} className={`relative overflow-hidden ${className}`} aria-hidden>
      <div
        className="absolute left-0 top-0 overflow-hidden"
        style={tela_}
        data-demo-pb={identidade.pretoEBranco ? "" : undefined}
      >
        <div
          style={{
            transform: rolar ? `translateY(${-rolar}px)` : undefined,
            transition: "transform 1.6s cubic-bezier(.4,0,.2,1)",
          }}
        >
          {!semCapa && (
            <GaleriaCapa
              aparencia={ap}
              dados={{
                titulo: identidade.titulo,
                subtitulo: identidade.local,
                dataFormatada: identidade.data,
                estudio: "Seu Estúdio",
                logoUrl: null,
                urlImagem: capa.src,
                focoX: capa.focoX,
                focoY: capa.focoY,
                capaEscolhida: true,
              }}
            />
          )}
          <div
            className="relative z-10 mx-auto max-w-[1500px] px-4 pt-6 sm:px-6"
            style={{ background: "var(--g-fundo)" }}
          >
            <GaleriaGrade
              aparencia={ap}
              quantidade={fotos.length}
              proporcao={(k) => fotos[k].largura / fotos[k].altura}
              render={(k, estilo, classe) => {
                const f = fotos[k];
                const marcada = favoritas?.includes(k) ?? false;
                return (
                  <div key={k} style={estilo} className={`relative ${classe}`}>
                    <span className="block h-full w-full overflow-hidden rounded-[var(--g-canto,6px)]">
                      <img
                        src={f.miniatura ?? f.src}
                        alt=""
                        width={f.largura}
                        height={f.altura}
                        loading={carregarAgora && k < 6 ? "eager" : "lazy"}
                        decoding="async"
                        className={cobre ? "h-full w-full object-cover" : "block h-auto w-full"}
                      />
                    </span>
                    {favoritas && (
                      <span
                        className={`absolute right-2 top-2 grid h-9 w-9 place-items-center ${
                          marcada && ultimaMarcada === k ? "home-coracao-pulsa" : ""
                        }`}
                        style={{
                          color: marcada ? "var(--g-destaque)" : "#fff",
                          filter: GLIFO_SOBRE_FOTO,
                          opacity: marcada ? 1 : 0.85,
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="19"
                          height="19"
                          fill={marcada ? "currentColor" : "none"}
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinejoin="round"
                        >
                          <path d={CORACAO} />
                        </svg>
                      </span>
                    )}
                  </div>
                );
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
