"use client";

import { useEffect, useState } from "react";

export interface FotoParaCapa {
  id: string;
  nome: string;
  url: string;
}

/**
 * O POP-UP DE ESCOLHER A FOTO DE CAPA.
 *
 * ── O PEDIDO (08/09/2026) ─────────────────────────────────────────────────
 *
 * Felipe: "abrir um pop up para selecionar a foto de capa, ao invés de ir para
 * a galeria, facilita para o usuário".
 *
 * Ele tem razão, e o caminho anterior era pior do que parece: "Usar uma foto da
 * galeria" era um LINK para a aba Fotos, onde a pessoa tinha de rolar centenas
 * de miniaturas procurando o botão "capa" que aparece no hover de cada uma — e
 * depois voltar para o Design para ver o resultado. Três telas para uma
 * decisão.
 *
 * ── POR QUE ISTO NÃO DESFAZ A RAZÃO DE SER UM LINK ────────────────────────
 *
 * O comentário antigo dizia, com razão, que desenhar a grade dentro do Design
 * obrigaria a aba a carregar as mídias e assinar uma miniatura por foto — 600
 * num casamento —, que é exatamente a carga que a divisão em abas veio cortar.
 *
 * A diferença é QUANDO. A lista é buscada só quando o pop-up abre, e quem entra
 * no Design para trocar a fonte não paga nada. É a mesma ideia das URLs sob
 * demanda: o custo existe, e ele passa a ser de quem usa.
 */
export function EscolherCapa({
  galeriaId,
  aberto,
  aoFechar,
  aoEscolher,
}: {
  galeriaId: string;
  aberto: boolean;
  aoFechar: () => void;
  aoEscolher: (mediaId: string) => void;
}) {
  const [fotos, setFotos] = useState<FotoParaCapa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || fotos) return;
    let vivo = true;
    (async () => {
      try {
        const r = await fetch(`/api/galerias/${galeriaId}/fotos`);
        if (!r.ok) throw new Error();
        const d = await r.json();
        if (vivo) setFotos(d.fotos);
      } catch {
        if (vivo) setErro("Não consegui carregar as fotos. Tente de novo.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [aberto, fotos, galeriaId]);

  /* Esc fecha. Sem isto o pop-up é uma armadilha para quem usa teclado — e a
     tecla que todo mundo tenta primeiro. */
  useEffect(() => {
    if (!aberto) return;
    const ouvir = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", ouvir);
    return () => window.removeEventListener("keydown", ouvir);
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Escolher a foto da capa"
      className="fixed inset-0 z-50 grid place-items-center bg-void/80 p-4 backdrop-blur-sm"
      onClick={aoFechar}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-linha bg-carbon shadow-2xl"
      >
        <div className="flex items-center justify-between gap-4 border-b border-linha px-5 py-3">
          <span className="text-sm font-semibold">Escolher a foto da capa</span>
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-lg border border-linha px-3 py-1.5 text-xs text-texto-soft transition hover:bg-carbon-2"
          >
            fechar
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {erro && <p className="text-sm text-erro">{erro}</p>}
          {!erro && !fotos && <p className="text-sm text-texto-faint">carregando as fotos…</p>}
          {fotos?.length === 0 && (
            <p className="text-sm text-texto-faint">
              Esta galeria ainda não tem foto. Envie as fotos na aba Fotos e volte aqui.
            </p>
          )}
          {fotos && fotos.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {fotos.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => aoEscolher(f.id)}
                    className="block w-full overflow-hidden rounded-lg border border-linha transition hover:border-acento focus:outline-none focus-visible:border-acento"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária */}
                    <img
                      src={f.url}
                      alt={f.nome}
                      loading="lazy"
                      className="aspect-[4/5] w-full object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
