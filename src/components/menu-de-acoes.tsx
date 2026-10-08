"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export interface ItemDoMenu {
  rotulo: string;
  aoEscolher: () => void;
  desabilitado?: boolean;
  /** Por que está apagado — botão apagado sem explicação parece quebrado. */
  dica?: string;
}

/**
 * O menu dos três pontinhos (⋯).
 *
 * ── DE ONDE VEIO (08/10/2026) ─────────────────────────────────────────────
 *
 * Felipe, pedindo o "mover para outra galeria": "gosto da ideia disso ser uma
 * opção dentro de um submenu '…' — para não ficar muito poluído visualmente".
 * A linha de cada capítulo já carrega setas, ordenar, tirar, renomear e apagar;
 * e a barra de seleção, cinco controles. Uma ação rara, que muda fotos de
 * galeria, não merece o sexto botão da fila — merece ficar à mão e fora da vista.
 *
 * Fecha com Esc, com clique fora e ao escolher; as setas percorrem os itens.
 * Os itens são botões de verdade (`role="menuitem"`), então teclado e leitor de
 * tela funcionam sem trabalho extra.
 */
export function MenuDeAcoes({
  rotulo,
  itens,
  desabilitado = false,
}: {
  /** O que o leitor de tela diz do botão: "Mais ações de Festa". */
  rotulo: string;
  itens: ItemDoMenu[];
  desabilitado?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  /* Quanto o menu é empurrado para caber na janela. Ele nasce alinhado à
     direita do botão (que costuma ser o último da fila), mas num celular a fila
     quebra de linha e o botão pode ficar em QUALQUER ponto — na ponta esquerda
     ou no meio —, e nenhum lado fixo cabe em todos os casos. Mede-se ao abrir e
     empurra-se o que sobrar para fora. */
  const [empurrao, setEmpurrao] = useState(0);
  const janela = useRef<HTMLDivElement>(null);
  const raiz = useRef<HTMLSpanElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const idDoMenu = useId();

  useLayoutEffect(() => {
    if (!aberto) return;
    const caixa = janela.current?.getBoundingClientRect();
    if (!caixa) return;
    /* 8 px de respiro: o menu encostado na borda parece cortado mesmo quando
       cabe. A esquerda vence se os dois lados estourarem (janela minúscula). */
    const folga = 8;
    let dx = 0;
    if (caixa.right > window.innerWidth - folga) dx = window.innerWidth - folga - caixa.right;
    if (caixa.left + dx < folga) dx = folga - caixa.left;
    if (dx !== 0) setEmpurrao(dx);
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    };
    const teclas = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAberto(false);
        botao.current?.focus();
      }
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", teclas);
    /* Quem abre pelo teclado precisa já estar dentro do menu. */
    raiz.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", teclas);
    };
  }, [aberto]);

  function andar(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const lista = [
      ...(raiz.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []),
    ];
    if (lista.length === 0) return;
    const i = lista.indexOf(document.activeElement as HTMLButtonElement);
    const passo = e.key === "ArrowDown" ? 1 : -1;
    lista[(i + passo + lista.length) % lista.length].focus();
  }

  return (
    <span ref={raiz} className="relative inline-block">
      <button
        ref={botao}
        type="button"
        disabled={desabilitado}
        aria-label={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? idDoMenu : undefined}
        onClick={() => {
          /* Cada abertura recomeça pelo lado padrão: a fila pode ter quebrado
             de linha (ou a janela mudado de tamanho) desde a última vez. */
          setEmpurrao(0);
          setAberto((a) => !a);
        }}
        className="rounded-md border border-linha px-2 py-1 text-xs leading-none text-texto-soft transition hover:bg-carbon-2 disabled:opacity-50"
      >
        <span aria-hidden="true" className="text-base leading-none">
          ⋯
        </span>
      </button>

      {aberto && (
        <div
          ref={janela}
          id={idDoMenu}
          role="menu"
          aria-label={rotulo}
          onKeyDown={andar}
          style={empurrao ? { transform: `translateX(${empurrao}px)` } : undefined}
          className="absolute right-0 top-full z-30 mt-1 w-max min-w-[14rem] max-w-[min(20rem,calc(100vw-1rem))] rounded-lg border border-linha bg-carbon-2 p-1 shadow-lg"
        >
          {itens.map((item) => (
            <button
              key={item.rotulo}
              type="button"
              role="menuitem"
              disabled={item.desabilitado}
              title={item.desabilitado ? item.dica : undefined}
              onClick={() => {
                setAberto(false);
                item.aoEscolher();
              }}
              className="block w-full rounded-md px-3 py-2 text-left text-xs text-texto transition hover:bg-carbon focus:bg-carbon focus:outline-none disabled:opacity-40"
            >
              {item.rotulo}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
