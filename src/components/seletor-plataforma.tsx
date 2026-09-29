"use client";

import { useEffect } from "react";
import Link from "next/link";
import { MarcaSimbolo } from "@/components/marca-tile";
import { irParaAba } from "@/lib/aba-nomeada";

/**
 * O SELETOR DE PLATAFORMA — "Galeria Átomo | Atomatiza", como duas abas.
 *
 * Só aparece para quem tem conta nas duas (ver `lib/ponte-atomatiza.ts`); quem
 * decide é o layout do painel. Aqui é só o desenho e o comportamento de aba.
 *
 * ── COMO VIRA ABA ─────────────────────────────────────────────────────────
 *
 * O link para o Atomatiza abre com `target` NOMEADO, e não `_blank`: o
 * primeiro clique abre uma aba nova, e os seguintes voltam para a mesma, em vez
 * de empilhar uma aba por clique. Para a volta também cair aqui, esta janela
 * se chama `JANELA_GALERIA` — o Atomatiza aponta o link de lá para esse nome.
 * Quando a aba já existe, o clique só a traz para a frente, sem recarregar
 * (`lib/aba-nomeada.ts`); o `target` fica para o clique sem JavaScript.
 *
 * Sem `rel="noopener"` de propósito: com ele o navegador põe a aba nova num
 * grupo à parte, e o nome deixa de ser encontrado — cada clique voltaria a
 * abrir uma aba. O risco que o `noopener` evita (a página aberta mexer nesta)
 * não se aplica: do outro lado está o Atomatiza, que é nosso.
 *
 * ── A MARCA DE CADA UM ────────────────────────────────────────────────────
 *
 * A aba acesa leva a nossa marca nas cores dela. A do Atomatiza vai no cinza da
 * interface, sem o azul de lá: é a regra da estratégia de marca (§1) — cada
 * produto com a sua cara, e um não pinta o outro. Lá é o mesmo, ao contrário.
 */
export function SeletorPlataforma({
  linkAtomatiza,
  janelaGaleria,
  janelaAtomatiza,
  largo = false,
}: {
  linkAtomatiza: string;
  janelaGaleria: string;
  janelaAtomatiza: string;
  /** No celular: ocupa a largura toda, em duas metades iguais. */
  largo?: boolean;
}) {
  useEffect(() => {
    window.name = janelaGaleria;
  }, [janelaGaleria]);

  const aba = `flex h-[30px] items-center gap-2 whitespace-nowrap rounded-full pl-2.5 pr-3.5 text-[12.5px] font-medium transition ${
    largo ? "flex-1 justify-center" : ""
  }`;

  return (
    <nav
      aria-label="Plataforma"
      className={`items-center gap-0.5 rounded-full border border-linha p-[3px] ${largo ? "flex w-full" : "inline-flex"}`}
    >
      <Link href="/painel" aria-current="true" className={`${aba} bg-carbon-2 text-texto ring-1 ring-inset ring-linha`}>
        {/* Desenho completo, o mesmo do logo do site: a versão miúda (duas
            órbitas, sem a câmera) virava um "88" no botão. */}
        <MarcaSimbolo tamanho={22} completo />
        Galeria Átomo
      </Link>
      <a
        href={linkAtomatiza}
        target={janelaAtomatiza}
        onClick={(e) => irParaAba(e, linkAtomatiza, janelaAtomatiza)}
        title="Abrir o Atomatiza (em outra aba)"
        className={`${aba} text-texto-soft hover:bg-carbon hover:text-texto`}
      >
        <OrbitaAtomatiza />
        Atomatiza
        <SetaParaFora />
        <span className="sr-only">(abre em outra aba)</span>
      </a>
    </nav>
  );
}

/**
 * O símbolo do Atomatiza — as três órbitas de `components/orbita.tsx` de lá —
 * parado e na cor do texto. Parado porque, aqui, ele é rótulo e não marca: o
 * nosso átomo já anda no logo ao lado, e dois girando disputariam o olho.
 */
function OrbitaAtomatiza() {
  return (
    <svg viewBox="0 0 64 64" width={15} height={15} fill="none" aria-hidden className="shrink-0">
      {[0, 60, 120].map((giro) => (
        <g key={giro} transform={`rotate(${giro} 32 32)`}>
          <ellipse cx="32" cy="32" rx="28" ry="11" stroke="currentColor" strokeOpacity="0.35" strokeWidth="3" />
        </g>
      ))}
      <circle cx="60" cy="32" r="4.5" fill="currentColor" />
      <circle cx="32" cy="32" r="6.5" fill="currentColor" />
    </svg>
  );
}

/** "Sai daqui": o clique troca de aba, e a seta avisa antes. */
function SetaParaFora() {
  return (
    <svg
      viewBox="0 0 12 12"
      width={10}
      height={10}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      aria-hidden
      className="shrink-0 text-texto-faint"
    >
      <path d="M4 2.5h5.5V8M9.5 2.5 2.5 9.5" />
    </svg>
  );
}
