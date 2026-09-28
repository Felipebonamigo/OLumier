"use client";

import { useEffect, useState } from "react";
import { marca } from "@/config/marca";
import type { FotosDaHome, Identidade } from "@/config/home-demonstracao";
import { GaleriaDemo } from "./galeria-demo";
import { usePedeMenosMovimento } from "./usa-celular";

/**
 * O PALCO DO HERO — três galerias, a mesma plataforma.
 *
 * Briefing §5: "é a mesma plataforma, mas não parece a mesma galeria", e isso
 * precisa chegar ANTES da leitura. No computador as três ficam no palco ao
 * mesmo tempo, uma na frente e duas atrás, e trocam de lugar devagar. No
 * celular não cabem três: fica uma, e a troca é por esmaecimento.
 *
 * As legendas embaixo são botões — trazem a galeria para a frente e param a
 * rotação. Quem pediu menos movimento no sistema recebe o palco parado.
 */

const SEGUNDOS = 5.5;

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
  const menosMovimento = usePedeMenosMovimento();

  useEffect(() => {
    if (parado || menosMovimento) return;
    const relogio = setInterval(
      () => setFrente((f) => (f + 1) % identidades.length),
      SEGUNDOS * 1000,
    );
    return () => clearInterval(relogio);
  }, [parado, menosMovimento, identidades.length]);

  return (
    <div>
      <div className="relative aspect-[390/560] w-full sm:aspect-[4/5] md:aspect-[16/10]">
        {identidades.map((ident, i) => {
          const distancia = (i - frente + identidades.length) % identidades.length;
          const naFrente = distancia === 0;
          return (
            <figure
              key={ident.id}
              className={`absolute inset-0 flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_30px_80px_-30px_rgba(20,20,20,0.45)] ring-1 ring-black/5 transition-all duration-[900ms] ease-[cubic-bezier(.4,0,.2,1)] ${LUGAR[distancia]}`}
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
              />
            </figure>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2 md:justify-start">
        {identidades.map((ident, i) => (
          <button
            key={ident.id}
            type="button"
            onClick={() => {
              setFrente(i);
              setParado(true);
            }}
            aria-pressed={frente === i}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              frente === i
                ? "border-[var(--h-tinta)] bg-[var(--h-tinta)] text-white"
                : "border-[var(--h-linha-forte)] text-[var(--h-tinta-2)] hover:border-[var(--h-tinta)]"
            }`}
          >
            {ident.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
