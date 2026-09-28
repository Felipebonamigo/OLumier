"use client";

import { useEffect, useState } from "react";
import type { FotosDaHome, Identidade } from "@/config/home-demonstracao";
import { GaleriaDemo } from "./galeria-demo";
import { usePedeMenosMovimento } from "./usa-celular";

/**
 * A SELEÇÃO ACONTECENDO — corações sendo marcados na grade de verdade.
 *
 * Briefing §10 e §23: "uma galeria grande com alguns corações marcados" e "um
 * coração é marcado". A grade é a do cliente (`GaleriaDemo`), o coração é o
 * mesmo desenho, e o contador é o que a galeria mostra.
 *
 * SEM "DE 40" (26/09/2026). O contador dizia "12 de 40 escolhidas", e a home
 * passava a ideia de que a favorita tem teto — Felipe: "por que tem limite de
 * 40? Deixa ilimitado". Na galeria real não há limite nenhum até o fotógrafo
 * definir um; a demonstração mostra esse padrão.
 */

const INICIAIS = [0, 3];
const SEQUENCIA = [5, 1, 6, 2];
const JA_ESCOLHIDAS = 9; // as que estariam fora da tela, para o contador ler como álbum

export function SelecaoDemo({ identidade, fotos }: { identidade: Identidade; fotos: FotosDaHome }) {
  const [marcadas, setMarcadas] = useState<number[]>(INICIAIS);
  const menosMovimento = usePedeMenosMovimento();

  useEffect(() => {
    if (menosMovimento) return;
    const relogio = setInterval(() => {
      setMarcadas((atual) => {
        const proxima = SEQUENCIA.find((i) => !atual.includes(i));
        return proxima === undefined ? INICIAIS : [...atual, proxima];
      });
    }, 1800);
    return () => clearInterval(relogio);
  }, [menosMovimento]);

  const ultima = marcadas.length > INICIAIS.length ? marcadas.at(-1)! : null;

  return (
    <div className="relative">
      <GaleriaDemo
        identidade={identidade}
        fotos={fotos}
        semCapa
        favoritas={marcadas}
        ultimaMarcada={ultima}
        className="aspect-[390/520] w-full rounded-2xl ring-1 ring-black/5 md:aspect-[5/4]"
      />
      <p
        className="absolute left-4 top-4 whitespace-nowrap rounded-full bg-[var(--h-tinta)] px-4 py-2 text-sm font-medium text-white shadow-lg"
        aria-live="off"
      >
        <span aria-hidden>♥ </span>
        <span className="tabular-nums">{JA_ESCOLHIDAS + marcadas.length}</span> escolhidas
      </p>
    </div>
  );
}
