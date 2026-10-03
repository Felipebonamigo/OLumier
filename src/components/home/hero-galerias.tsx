"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { marca } from "@/config/marca";
import type { FotosDaHome, Identidade } from "@/config/home-demonstracao";
import { GaleriaDemo } from "./galeria-demo";
import { corDaFoto } from "./cor-da-foto";
import { usePedeMenosMovimento } from "./usa-celular";

/**
 * O PALCO DO HERO — três galerias, a mesma plataforma.
 *
 * Briefing §5: "é a mesma plataforma, mas não parece a mesma galeria", e isso
 * precisa chegar ANTES da leitura. No computador as três ficam no palco ao
 * mesmo tempo, uma na frente e duas atrás, e trocam de lugar devagar. No
 * celular não cabem três: fica uma, e a troca é uma cortina de baixo para cima.
 *
 * ── EM MOVIMENTO (03/10/2026) ────────────────────────────────────────────
 *
 * Felipe aprovou a proposta da "home em movimento" (o protótipo está no
 * registro de `docs/home-leitura-critica.md`). Aqui ela trouxe três coisas,
 * todas mostrando o produto e nenhuma só enfeite:
 *
 *  - a galeria da frente ROLA SOZINHA — é a galeria de verdade, então rolar é
 *    mostrar que embaixo da capa tem a entrega inteira;
 *  - o BRILHO atrás do palco tem a cor da capa da frente, lida da foto (ver
 *    `cor-da-foto.ts`): a cor da página é sempre a do fotógrafo;
 *  - as fichas embaixo têm uma barra que enche no tempo da troca. A troca
 *    acontece quando a barra acaba (`animationend`), e não num relógio à parte:
 *    parar a barra com o mouse em cima do palco para a troca junto.
 *
 * As fichas continuam botões — trazem a galeria para a frente e param a
 * rotação. Quem pediu menos movimento no sistema recebe o palco parado.
 */

const SEGUNDOS = 6;
/* Quanto a galeria da frente desce a cada passo, em pixels da tela virtual
   (`GaleriaDemo`). Três passos cabem na vez dela. */
const PASSO_DA_ROLAGEM = 360;
const PASSOS_DA_ROLAGEM = 3;

/* Onde cada galeria fica, pela distância até a da frente. No celular as três
   ocupam o mesmo lugar e só a da frente aparece. */
const LUGAR = [
  "z-30 opacity-100 md:left-[17%] md:top-[5%] md:h-[95%] md:w-[66%]",
  "z-20 opacity-0 md:opacity-100 md:left-[52%] md:top-[15%] md:h-[80%] md:w-[48%]",
  "z-10 opacity-0 md:opacity-100 md:left-0 md:top-0 md:h-[80%] md:w-[48%]",
];

export function HeroGalerias({
  identidades,
  fotos,
}: {
  identidades: Identidade[];
  fotos: FotosDaHome;
}) {
  const [frente, setFrente] = useState(0);
  const [parado, setParado] = useState(false);
  const [rolar, setRolar] = useState(0);
  const [brilho, setBrilho] = useState<string | null>(null);
  const menosMovimento = usePedeMenosMovimento();
  const girando = !parado && !menosMovimento;

  /* A galeria da frente desce aos poucos; a que sai volta ao topo. A troca
     zera `rolar` no mesmo clique que muda a frente (ver `trazer`). */
  useEffect(() => {
    if (menosMovimento) return;
    let passo = 0;
    const relogio = setInterval(() => {
      passo = Math.min(passo + 1, PASSOS_DA_ROLAGEM);
      setRolar(passo * PASSO_DA_ROLAGEM);
    }, (SEGUNDOS * 1000) / (PASSOS_DA_ROLAGEM + 1));
    return () => clearInterval(relogio);
  }, [frente, menosMovimento]);

  /* O brilho segue a capa da frente. */
  useEffect(() => {
    const capa = fotos[identidades[frente].capa];
    let vivo = true;
    void corDaFoto(capa.miniatura ?? capa.src).then((cor) => {
      if (vivo && cor) setBrilho(cor);
    });
    return () => {
      vivo = false;
    };
  }, [frente, fotos, identidades]);

  const trazer = (i: number) => {
    setRolar(0);
    setFrente(i);
  };

  return (
    <div className="relative isolate">
      <div
        aria-hidden
        className="home-brilho"
        style={{ ["--brilho" as string]: brilho ?? "transparent" } as CSSProperties}
      />
      <div className="home-palco relative aspect-[390/560] w-full sm:aspect-[4/5] md:aspect-[16/10]">
        {identidades.map((ident, i) => {
          const distancia = (i - frente + identidades.length) % identidades.length;
          const naFrente = distancia === 0;
          return (
            <figure
              key={ident.id}
              className={`absolute inset-0 flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_30px_80px_-30px_rgba(20,20,20,0.45)] ring-1 ring-black/5 transition-all duration-[900ms] ease-[cubic-bezier(.4,0,.2,1)] ${LUGAR[distancia]} ${naFrente ? "home-palco-frente" : ""}`}
              aria-hidden={!naFrente}
            >
              {/* A barra de endereço é parte da prova: o link é do estúdio. */}
              <div className="flex h-8 shrink-0 items-center gap-2 border-b border-black/5 bg-white px-3">
                <span className="flex gap-1" aria-hidden>
                  <i className="block size-2 rounded-full bg-black/10" />
                  <i className="block size-2 rounded-full bg-black/10" />
                  <i className="block size-2 rounded-full bg-black/10" />
                </span>
                <span className="mx-auto truncate rounded-full bg-black/[0.04] px-3 py-0.5 font-mono text-[10.5px] text-[var(--h-tinta-3)]">
                  seuestudio.{marca.dominio}/{ident.slug}
                </span>
              </div>
              <GaleriaDemo
                identidade={ident}
                fotos={fotos}
                className="min-h-0 flex-1"
                carregarAgora={i === 0}
                rolar={naFrente ? rolar : 0}
              />
            </figure>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2" role="group" aria-label="Galerias de exemplo">
        {identidades.map((ident, i) => {
          const ativa = frente === i;
          return (
            <button
              key={ident.id}
              type="button"
              onClick={() => {
                trazer(i);
                setParado(true);
              }}
              aria-pressed={ativa}
              className={`relative min-w-0 overflow-hidden rounded-xl border px-3 pb-3 pt-2.5 text-left transition ${
                ativa
                  ? "border-[var(--h-linha-forte)] bg-white shadow-[0_8px_24px_-16px_rgba(20,20,20,0.5)]"
                  : "border-[var(--h-linha)] bg-white/50 hover:border-[var(--h-linha-forte)]"
              }`}
            >
              <span className="block truncate text-[13px] font-medium text-[var(--h-tinta)]">{ident.rotulo}</span>
              <span className="mt-0.5 block truncate font-mono text-[10.5px] text-[var(--h-tinta-3)]">
                {ident.titulo}
              </span>
              {ativa && girando && (
                <i
                  key={frente}
                  aria-hidden
                  className="home-ficha-tempo"
                  style={{ ["--tempo" as string]: `${SEGUNDOS}s` } as CSSProperties}
                  onAnimationEnd={() => trazer((frente + 1) % identidades.length)}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
