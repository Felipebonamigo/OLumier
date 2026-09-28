"use client";

import { useEffect, useState } from "react";
import type { FotoDemo } from "@/config/home-demonstracao";
import { usePedeMenosMovimento } from "./usa-celular";

/**
 * O CAMINHO DE UMA GALERIA PELO COFRE — no ar, vence, guarda, volta.
 *
 * Briefing §12 e §23: GALERIA ATIVA → PRAZO ENCERRADO → COFRE → RESTAURAR, e
 * "uma galeria passa de ativa → Cofre → restaurada". O cartão é o jeito como o
 * painel mostra uma galeria; o que muda é o estado dele, um de cada vez.
 *
 * Os prazos citados são os de `config/prazos.ts`. "No mesmo endereço" é o
 * comportamento de reativar (`lib/cofre.ts`): a galeria volta com o link que o
 * cliente já tem.
 *
 * Com menos movimento pedido, os quatro estados aparecem juntos, sem o cartão
 * andar — é a mesma informação, só que parada.
 */

const ESTADOS = [
  { rotulo: "No ar", detalhe: "O cliente abre o link e baixa quando quiser.", cor: "#1f7a4d" },
  {
    rotulo: "Prazo encerrado",
    detalhe: "No prazo que você escolheu: 6 meses, 1 ano, 2 anos ou sem prazo.",
    cor: "#9a6a12",
  },
  { rotulo: "No Cofre", detalhe: "O link sai do ar. Nenhum arquivo é apagado.", cor: "#48484d" },
  { rotulo: "Restaurada", detalhe: "Um clique e ela volta, no mesmo endereço.", cor: "#1f7a4d" },
] as const;

/**
 * `foto`: a do lugar `LUGAR_DO_COFRE`, já com a troca do admin se houver.
 * `titulo`: o nome da galeria dona dessa foto — o cartão não pode dizer um
 * casal e mostrar outro.
 */
export function CofreDemo({ foto, titulo }: { foto: FotoDemo; titulo: string }) {
  const [atual, setAtual] = useState(0);
  const menosMovimento = usePedeMenosMovimento();

  useEffect(() => {
    if (menosMovimento) return;
    const relogio = setInterval(() => setAtual((a) => (a + 1) % ESTADOS.length), 2600);
    return () => clearInterval(relogio);
  }, [menosMovimento]);

  const estado = ESTADOS[atual];

  return (
    <div>
      {/* O cartão da galeria, como no painel. */}
      <div className="mx-auto flex max-w-sm items-center gap-4 rounded-2xl bg-white p-3 shadow-[0_20px_50px_-25px_rgba(20,20,20,0.45)] ring-1 ring-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element -- foto estática de /public */}
        <img
          src={foto.miniatura ?? foto.src}
          alt=""
          width={foto.largura}
          height={foto.altura}
          loading="lazy"
          className={`h-16 w-24 rounded-lg object-cover transition duration-700 ${
            atual === 2 && !menosMovimento ? "opacity-40 grayscale" : ""
          }`}
        />
        <div className="min-w-0">
          <p className="truncate font-medium">{titulo}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm" aria-live="polite">
            <span
              aria-hidden
              className="block size-2 rounded-full transition-colors duration-500"
              style={{ background: menosMovimento ? ESTADOS[0].cor : estado.cor }}
            />
            <span className="text-[var(--h-tinta-2)]">
              {menosMovimento ? ESTADOS[0].rotulo : estado.rotulo}
            </span>
          </p>
        </div>
      </div>

      <ol className="mt-10 grid gap-px overflow-hidden rounded-2xl bg-[var(--h-linha)] ring-1 ring-[var(--h-linha)] sm:grid-cols-4">
        {ESTADOS.map((e, i) => {
          const aceso = menosMovimento || i === atual;
          return (
            <li
              key={e.rotulo}
              className={`bg-[var(--h-papel)] p-5 transition-colors duration-500 ${
                aceso ? "bg-white" : ""
              }`}
            >
              <p className="font-mono text-xs text-[var(--h-tinta-3)]">0{i + 1}</p>
              <p
                className={`home-titulo mt-2 text-xl font-semibold transition-opacity duration-500 ${
                  aceso ? "opacity-100" : "opacity-40"
                }`}
              >
                {e.rotulo}
              </p>
              <p
                className={`mt-1.5 text-sm leading-snug text-[var(--h-tinta-2)] transition-opacity duration-500 ${
                  aceso ? "opacity-100" : "opacity-50"
                }`}
              >
                {e.detalhe}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
