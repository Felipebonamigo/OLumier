"use client";

import { useCallback, useEffect, useState } from "react";
import { GaleriaGrade } from "./galeria-grade";
import type { Aparencia } from "@/config/aparencia";

export interface ItemGaleria {
  id: string;
  nome: string;
  tipo: "foto" | "video";
  /** miniatura da grade (~50 KB) */
  url: string;
  /** versão do lightbox (~400 KB) */
  urlGrande: string;
  /** original, com nome de arquivo para salvar */
  urlDownload: string;
  bytes: number;
  largura: number | null;
  altura: number | null;
}

export interface CapituloGaleria {
  id: string;
  nome: string;
  /** índices em `itens` — o lightbox continua percorrendo a galeria inteira */
  indices: number[];
}

/**
 * A galeria que o cliente final vê. Fotos em grade, lightbox com teclado,
 * vídeo com player, download individual e em lote.
 */
export function GaleriaCliente({
  itens,
  permiteDownload,
  galeriaId,
  aparencia,
  capitulos,
}: {
  itens: ItemGaleria[];
  permiteDownload: boolean;
  galeriaId: string;
  aparencia: Aparencia;
  capitulos: CapituloGaleria[];
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

  /**
   * Pré-carrega a foto seguinte e a anterior enquanto o visitante olha a atual.
   * Quem navega de seta em seta vê a próxima aparecer instantaneamente, em vez
   * de esperar o download a cada clique.
   */
  useEffect(() => {
    if (aberto === null || itens.length < 2) return;
    for (const i of [(aberto + 1) % itens.length, (aberto - 1 + itens.length) % itens.length]) {
      const vizinho = itens[i];
      if (vizinho.tipo === "foto") new Image().src = vizinho.urlGrande;
    }
  }, [aberto, itens]);

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
            className="rounded-full px-6 py-3 text-sm font-semibold transition hover:opacity-85 disabled:opacity-60"
            style={{ background: "var(--g-destaque)", color: "var(--g-sobre-destaque)" }}
          >
            {baixandoTudo
              ? `Baixando ${progressoLote} de ${itens.length}…`
              : `↓ Baixar tudo (${itens.length})`}
          </button>
          <span className="text-xs" style={{ color: "var(--g-tenue)" }}>
            sem limite de downloads — baixe quantas vezes quiser
          </span>
        </div>
      )}

      {/* Menu de capítulos — o cliente pula direto ao momento que quer ver. */}
      {capitulos.length > 1 && (
        <nav
          className="sticky top-0 z-20 -mx-4 mt-8 overflow-x-auto px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
          style={{
            background: "color-mix(in srgb, var(--g-fundo) 88%, transparent)",
            borderBottom: "1px solid var(--g-linha)",
          }}
          aria-label="Capítulos da galeria"
        >
          <ul className="flex justify-center gap-1 whitespace-nowrap">
            {capitulos.map((c) => (
              <li key={c.id}>
                <a
                  href={`#cap-${c.id}`}
                  className="inline-block rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition hover:opacity-70"
                  style={{ color: "var(--g-suave)" }}
                >
                  {c.nome}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div id="fotos" className="mt-8 scroll-mt-4">
        {capitulos.map((cap) => (
          <section key={cap.id} id={`cap-${cap.id}`} className="mb-12 scroll-mt-16">
            {cap.nome && (
              <h2
                className="mb-4 text-center font-mono text-[11px] uppercase tracking-[0.3em]"
                style={{ color: "var(--g-destaque)" }}
              >
                {cap.nome}
              </h2>
            )}
            <GaleriaGrade
              aparencia={aparencia}
              quantidade={cap.indices.length}
              proporcao={(k) => {
                const it = itens[cap.indices[k]];
                return it.largura && it.altura ? it.largura / it.altura : 4 / 5;
              }}
              render={(k, estilo, classe) => {
                const i = cap.indices[k];
                const it = itens[i];
            // "linhas" e "editorial" definem a altura; nas outras a proporção
            // da própria foto manda, para o mural não ficar todo igual.
            const alturaPeloLayout =
              aparencia.grade === "linhas" || aparencia.grade === "editorial";
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => {
                  setAberto(i);
                  registrar(it.tipo === "video" ? "assistiu" : "abriu", it.id);
                }}
                style={estilo}
                className={`group relative overflow-hidden rounded-md ${classe}`}
                aria-label={`Abrir ${it.nome}`}
              >
                {it.tipo === "foto" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
                  <img
                    src={it.url}
                    alt={it.nome}
                    // As primeiras já aparecem na tela: carregar na hora evita o
                    // "pisca cinza" de quem chega. O resto vem sob demanda.
                    loading={i < 8 ? "eager" : "lazy"}
                    fetchPriority={i < 4 ? "high" : "auto"}
                    decoding="async"
                    width={it.largura ?? undefined}
                    height={it.altura ?? undefined}
                    className={`transition duration-500 group-hover:scale-[1.03] ${
                      alturaPeloLayout
                        ? "h-full w-full object-cover"
                        : aparencia.grade === "quadrada"
                          ? "h-full w-full object-cover"
                          : "block h-auto w-full"
                    }`}
                  />
                ) : (
                  <span
                    className="grid h-full min-h-[180px] w-full place-items-center"
                    style={{ background: "var(--g-superficie)" }}
                  >
                    <span
                      className="grid h-14 w-14 place-items-center rounded-full"
                      style={{ border: "1px solid var(--g-destaque)" }}
                    >
                      <span
                        className="ml-1 border-y-[9px] border-y-transparent border-l-[15px]"
                        style={{ borderLeftColor: "var(--g-destaque)" }}
                      />
                    </span>
                  </span>
                )}
              </button>
                );
              }}
            />
          </section>
        ))}
      </div>

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
                src={item.urlGrande}
                alt={item.nome}
                fetchPriority="high"
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            ) : (
              <video
                src={item.urlGrande}
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
