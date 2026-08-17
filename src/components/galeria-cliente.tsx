"use client";

import { useCallback, useEffect, useState } from "react";

export interface ItemGaleria {
  id: string;
  nome: string;
  tipo: "foto" | "video";
  url: string;
  urlDownload: string;
  bytes: number;
}

/**
 * A galeria que o cliente final vê. Fotos em grade, lightbox com teclado,
 * vídeo com player, download individual e em lote.
 */
export function GaleriaCliente({
  itens,
  permiteDownload,
  galeriaId,
}: {
  itens: ItemGaleria[];
  permiteDownload: boolean;
  galeriaId: string;
}) {
  const [aberto, setAberto] = useState<number | null>(null);
  const [baixandoTudo, setBaixandoTudo] = useState(false);
  const [progressoLote, setProgressoLote] = useState(0);

  const fechar = useCallback(() => setAberto(null), []);
  const anterior = useCallback(
    () => setAberto((i) => (i === null ? null : (i - 1 + itens.length) % itens.length)),
    [itens.length],
  );
  const proximo = useCallback(
    () => setAberto((i) => (i === null ? null : (i + 1) % itens.length)),
    [itens.length],
  );

  // Setas e Esc: quem abre uma galeria de casamento navega no teclado.
  useEffect(() => {
    if (aberto === null) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
      if (e.key === "ArrowLeft") anterior();
      if (e.key === "ArrowRight") proximo();
    };
    window.addEventListener("keydown", aoTeclar);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = "";
    };
  }, [aberto, fechar, anterior, proximo]);

  const registrar = (acao: string, mediaId?: string) => {
    // keepalive: o registro sobrevive à navegação que o download dispara.
    fetch(`/api/g/${galeriaId}/acesso`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao, mediaId }),
      keepalive: true,
    }).catch(() => {});
  };

  function baixarUm(item: ItemGaleria) {
    registrar("baixou", item.id);
    const a = document.createElement("a");
    a.href = item.urlDownload;
    a.download = item.nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /**
   * Download em lote, um arquivo por vez.
   *
   * Não geramos um ZIP no servidor de propósito: os arquivos ficam no
   * armazenamento e vão direto de lá para o cliente. Empacotar exigiria puxar
   * tudo para o nosso servidor primeiro — lento para o casal e caro para nós.
   */
  async function baixarTudo() {
    setBaixandoTudo(true);
    setProgressoLote(0);
    registrar("baixou_tudo");
    for (let i = 0; i < itens.length; i++) {
      const a = document.createElement("a");
      a.href = itens[i].urlDownload;
      a.download = itens[i].nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setProgressoLote(i + 1);
      // Intervalo curto: o navegador ignora downloads disparados todos de uma vez.
      await new Promise((r) => setTimeout(r, 700));
    }
    setBaixandoTudo(false);
  }

  const item = aberto === null ? null : itens[aberto];

  return (
    <>
      {permiteDownload && itens.length > 0 && (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={baixarTudo}
            disabled={baixandoTudo}
            className="rounded-lg bg-luz px-5 py-2.5 text-sm font-semibold text-void transition hover:bg-luz-alta disabled:opacity-60"
          >
            {baixandoTudo
              ? `Baixando ${progressoLote} de ${itens.length}…`
              : `↓ Baixar tudo (${itens.length})`}
          </button>
          <span className="text-xs text-texto-faint">
            sem limite de downloads — baixe quantas vezes quiser
          </span>
        </div>
      )}

      <ul className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {itens.map((it, i) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => {
                setAberto(i);
                registrar(it.tipo === "video" ? "assistiu" : "abriu", it.id);
              }}
              className="group relative block w-full overflow-hidden rounded-lg border border-linha bg-carbon-2"
              aria-label={`Abrir ${it.nome}`}
            >
              <span className="block aspect-[4/5]">
                {it.tipo === "foto" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
                  <img
                    src={it.url}
                    alt={it.nome}
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                  />
                ) : (
                  <span className="grid h-full w-full place-items-center bg-gradient-to-br from-carbon-2 to-void">
                    <span className="grid h-14 w-14 place-items-center rounded-full border border-luz-alta/70">
                      <span className="ml-1 border-y-[9px] border-l-[15px] border-y-transparent border-l-luz-alta" />
                    </span>
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {item && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={item.nome}
          className="fixed inset-0 z-50 flex flex-col bg-void/97 backdrop-blur"
          onClick={fechar}
        >
          <div className="flex items-center justify-between gap-4 px-5 py-4 text-sm">
            <span className="truncate text-texto-soft">
              {aberto! + 1} de {itens.length}
            </span>
            <span className="flex items-center gap-2">
              {permiteDownload && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    baixarUm(item);
                  }}
                  className="rounded-lg border border-linha-forte px-3 py-1.5 text-xs transition hover:bg-carbon"
                >
                  ↓ Baixar
                </button>
              )}
              <button
                type="button"
                onClick={fechar}
                aria-label="Fechar"
                className="rounded-lg border border-linha-forte px-3 py-1.5 text-xs transition hover:bg-carbon"
              >
                Fechar ✕
              </button>
            </span>
          </div>

          <div
            className="flex min-h-0 flex-1 items-center justify-center px-4 pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            {item.tipo === "foto" ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
              <img
                src={item.url}
                alt={item.nome}
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            ) : (
              <video
                src={item.url}
                controls
                autoPlay
                playsInline
                className="max-h-full max-w-full rounded-lg"
              />
            )}
          </div>

          {itens.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  anterior();
                }}
                aria-label="Anterior"
                className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-linha-forte bg-void/70 text-texto transition hover:bg-carbon"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  proximo();
                }}
                aria-label="Próxima"
                className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-linha-forte bg-void/70 text-texto transition hover:bg-carbon"
              >
                ›
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
