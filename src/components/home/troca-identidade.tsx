"use client";

import { useState } from "react";
import { FONTES_TITULO, type Aparencia } from "@/config/aparencia";
import { marca } from "@/config/marca";
import {
  TROCA_CAPAS,
  TROCA_CORES,
  TROCA_FONTES,
  type Identidade,
} from "@/config/home-demonstracao";
import { GaleriaDemo } from "./galeria-demo";

/**
 * "SEU TRABALHO. SUA MARCA. SEU ENDEREÇO." — a galeria que o visitante mexe.
 *
 * Briefing §7 pede que a interface faça quase todo o trabalho, e §23 pede que
 * trocar cor, tipografia ou capa altere a demonstração em tempo real. As duas
 * coisas cabem aqui: a galeria é a de verdade (`GaleriaDemo`), as opções são as
 * do editor de Design, e cada toque redesenha na hora — sem gravar nada, sem
 * pedir conta.
 *
 * O endereço na barra é o subdomínio que todo estúdio ganha. O domínio próprio
 * (galeria.seuestudio.com.br) não aparece enquanto `DOMINIO_PROPRIO_LIBERADO`
 * estiver desligado — ver `config/lancamentos.ts`.
 */
export function TrocaIdentidade({ base }: { base: Identidade }) {
  const [capa, setCapa] = useState<string>(base.aparencia.capa);
  const [fonte, setFonte] = useState<string>(base.aparencia.tipografia);
  const [cor, setCor] = useState<string>(TROCA_CORES[0].id);

  const paleta = TROCA_CORES.find((c) => c.id === cor) ?? TROCA_CORES[0];
  const aparencia: Aparencia = {
    ...base.aparencia,
    capa: capa as Aparencia["capa"],
    tipografia: fonte as Aparencia["tipografia"],
    tema: paleta.tema,
    cores: paleta.cores,
  };

  return (
    <div>
      <figure className="overflow-hidden rounded-2xl bg-white shadow-[0_30px_80px_-30px_rgba(20,20,20,0.4)] ring-1 ring-black/5">
        <div className="flex h-9 items-center gap-2 border-b border-black/5 px-3">
          <span className="flex gap-1" aria-hidden>
            <i className="block size-2 rounded-full bg-black/10" />
            <i className="block size-2 rounded-full bg-black/10" />
            <i className="block size-2 rounded-full bg-black/10" />
          </span>
          <span className="mx-auto truncate rounded-full bg-black/[0.04] px-3 py-0.5 font-mono text-[11px] text-[var(--h-tinta-2)]">
            <strong className="font-semibold text-[var(--h-tinta)]">seuestudio</strong>.
            {marca.dominio}/marina-e-caio
          </span>
        </div>
        <GaleriaDemo
          identidade={base}
          aparencia={aparencia}
          className="aspect-[390/600] w-full md:aspect-[16/10]"
        />
      </figure>

      <div className="mt-6 grid gap-5 sm:grid-cols-3">
        <Grupo rotulo="Capa">
          {TROCA_CAPAS.map((o) => (
            <Opcao key={o.id} ativa={capa === o.id} onClick={() => setCapa(o.id)}>
              {o.nome}
            </Opcao>
          ))}
        </Grupo>
        <Grupo rotulo="Fonte do título">
          {TROCA_FONTES.map((o) => (
            <Opcao key={o.id} ativa={fonte === o.id} onClick={() => setFonte(o.id)}>
              {/* Cada fonte escrita nela mesma — como no editor. */}
              <span style={{ fontFamily: FONTES_TITULO[o.id as Aparencia["tipografia"]] }}>
                {o.nome}
              </span>
            </Opcao>
          ))}
        </Grupo>
        <Grupo rotulo="Cores">
          {TROCA_CORES.map((o) => (
            <Opcao key={o.id} ativa={cor === o.id} onClick={() => setCor(o.id)}>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="block size-3.5 rounded-full ring-1 ring-black/15"
                  style={{
                    background: `linear-gradient(135deg, ${o.amostra[0]} 50%, ${o.amostra[1]} 50%)`,
                  }}
                />
                {o.nome}
              </span>
            </Opcao>
          ))}
        </Grupo>
      </div>
    </div>
  );
}

function Grupo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={rotulo}>
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--h-tinta-3)]">
        {rotulo}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Opcao({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition ${
        ativa
          ? "border-[var(--h-tinta)] bg-[var(--h-tinta)] text-white"
          : "border-[var(--h-linha-forte)] bg-white text-[var(--h-tinta)] hover:border-[var(--h-tinta)]"
      }`}
    >
      {children}
    </button>
  );
}
