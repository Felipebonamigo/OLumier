"use client";
/* eslint-disable @next/next/no-img-element -- as fotos da home, servidas como estão. */

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { FotoDemo } from "@/config/home-demonstracao";
import { usePedeMenosMovimento } from "./usa-celular";

/**
 * AS PEÇAS DO BLOCO DE RECURSOS (03/10/2026).
 *
 * Seleção, Cofre, segurança, lixeira, capítulos e "brasileira" eram seções
 * separadas, cada uma com a sua altura de tela. Viraram um bloco só, de peças
 * de tamanhos diferentes, e cada peça é uma demonstração viva do recurso — o
 * §2 do briefing pede "demonstração real, nunca ícone genérico". Aqui moram as
 * demonstrações pequenas; o texto de cada peça fica em `app/page.tsx`, perto do
 * resto do que a página afirma.
 *
 * Tudo para quem pediu menos movimento: o Cofre mostra os quatro estados
 * acesos, o relógio fica parado, os números aparecem sem contar.
 */

/** A peça: uma caixa com uma luz que segue o mouse no computador. */
export function Peca({ className = "", children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const mover = (e: PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <article ref={ref} onPointerMove={mover} className={`home-peca ${className}`}>
      {children}
    </article>
  );
}

/* ── Cofre: os quatro estados, um aceso de cada vez ─────────────────────── */
const ESTADOS = [
  { rotulo: "No ar", cor: "#1f7a4d" },
  { rotulo: "Prazo encerrado", cor: "#9a6a12" },
  { rotulo: "No Cofre", cor: "#48484d" },
  { rotulo: "Restaurada", cor: "#1f7a4d" },
] as const;

export function CofreEstados({ foto, titulo }: { foto: FotoDemo; titulo: string }) {
  const [atual, setAtual] = useState(0);
  const menosMovimento = usePedeMenosMovimento();
  useEffect(() => {
    if (menosMovimento) return;
    const relogio = setInterval(() => setAtual((a) => (a + 1) % ESTADOS.length), 2000);
    return () => clearInterval(relogio);
  }, [menosMovimento]);
  return (
    <div className="mt-auto grid gap-3">
      <div className="flex items-center gap-3 rounded-xl bg-[var(--h-papel)] p-2 ring-1 ring-[var(--h-linha)]">
        <img
          src={foto.miniatura ?? foto.src}
          alt=""
          loading="lazy"
          className={`h-11 w-16 rounded-md object-cover transition duration-700 ${
            atual === 2 && !menosMovimento ? "opacity-40 grayscale" : ""
          }`}
        />
        <p className="min-w-0 truncate text-sm font-medium">{titulo}</p>
      </div>
      <ol className="grid gap-1">
        {ESTADOS.map((e, i) => {
          const aceso = menosMovimento || i === atual;
          return (
            <li
              key={e.rotulo}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 font-mono text-[12.5px] transition-all duration-500 ${
                aceso ? "bg-[var(--h-papel)] text-[var(--h-tinta)] ring-1 ring-[var(--h-linha-forte)]" : "text-[var(--h-tinta-3)]"
              }`}
            >
              <span
                aria-hidden
                className="block size-2 rounded-full"
                style={{ background: aceso ? e.cor : "var(--h-linha-forte)" }}
              />
              {e.rotulo}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ── Um número que conta quando aparece ─────────────────────────────────── */
export function Conta({ ate }: { ate: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [valor, setValor] = useState(ate);
  const menosMovimento = usePedeMenosMovimento();
  useEffect(() => {
    const el = ref.current;
    if (!el || menosMovimento) return;
    let quadro = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const passo = (t: number) => {
          const p = Math.min(1, (t - t0) / 1400);
          setValor(Math.round(ate * (1 - Math.pow(1 - p, 3))));
          if (p < 1) quadro = requestAnimationFrame(passo);
        };
        setValor(0);
        quadro = requestAnimationFrame(passo);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(quadro);
    };
  }, [ate, menosMovimento]);
  return (
    <span ref={ref} className="tabular-nums">
      {valor.toLocaleString("pt-BR")}
    </span>
  );
}
