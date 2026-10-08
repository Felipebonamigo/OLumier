"use client";

import { useEffect, useRef, useState } from "react";
import { quadroTemImagem } from "@/lib/derivadas-client";
import { relogio } from "@/lib/formato-da-entrega";
import { cenaInicial, limitarCena, sortearCena } from "@/lib/cena-do-filme";

/** Quanto esperar o navegador abrir o filme antes de desistir e oferecer a saída. */
const PRAZO_PARA_ABRIR_MS = 15000;

/**
 * A janela onde o fotógrafo escolhe a CENA que vira a capa do filme.
 *
 * O filme vem do disco dele (`url` é um endereço local, de `createObjectURL`) —
 * a mesma decisão de `capa-de-video.tsx`: nada do filme sobe, só o quadro. O
 * quadro sai do `<video>` por um canvas, e de lá é conferido (o Safari já
 * devolveu quadro transparente sem erro nenhum — ver `quadroDoVideo`).
 *
 * Três caminhos de saída, para ninguém ficar preso:
 *   - "Usar esta cena": o quadro que está na tela;
 *   - "Quadro automático": o de antes, escolhido pelo sistema;
 *   - fechar: e escolher uma imagem no lugar do filme, como sempre.
 */
export function EscolherCena({
  nome,
  url,
  aoUsar,
  aoAutomatico,
  aoCancelar,
}: {
  nome: string;
  url: string;
  /** O quadro como arquivo de imagem, e a duração do filme quando se sabe. */
  aoUsar: (quadro: File, duracao: number | undefined) => void;
  aoAutomatico: () => void;
  aoCancelar: () => void;
}) {
  const filme = useRef<HTMLVideoElement>(null);
  const [duracao, setDuracao] = useState<number | null>(null);
  const [aberto, setAberto] = useState(false);
  const [semAbrir, setSemAbrir] = useState(false);
  const [agora, setAgora] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  /* O navegador que aceita o arquivo e nunca decodifica não dispara `error`:
     o prazo transforma o silêncio em saída. */
  useEffect(() => {
    if (aberto || semAbrir) return;
    const t = setTimeout(() => setSemAbrir(true), PRAZO_PARA_ABRIR_MS);
    return () => clearTimeout(t);
  }, [aberto, semAbrir]);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoCancelar();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoCancelar]);

  function irPara(segundos: number, total: number | null = duracao) {
    const v = filme.current;
    if (!v) return;
    setAviso(null);
    const alvo = limitarCena(segundos, total ?? segundos);
    v.currentTime = alvo;
    setAgora(alvo);
  }

  function aoCarregar() {
    const v = filme.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
    setDuracao(d);
    setAberto(true);
    if (d) irPara(cenaInicial(d), d);
  }

  async function usar() {
    const v = filme.current;
    if (!v || !v.videoWidth || !v.videoHeight) {
      setAviso("O navegador não mostrou o filme. Use o quadro automático ou feche e escolha uma imagem.");
      return;
    }
    const tela = document.createElement("canvas");
    tela.width = v.videoWidth;
    tela.height = v.videoHeight;
    const ctx = tela.getContext("2d");
    if (!ctx) {
      setAviso("Não consegui ler o quadro. Use o quadro automático ou feche e escolha uma imagem.");
      return;
    }
    ctx.drawImage(v, 0, 0, tela.width, tela.height);

    /* A conferência é numa miniatura, como em `quadroDoVideo`: medir 8 milhões
       de pixels de um 4K para saber se o quadro veio vazio seria desperdício. */
    const amostra = document.createElement("canvas");
    amostra.width = 32;
    amostra.height = 32;
    const ctxAmostra = amostra.getContext("2d", { willReadFrequently: true });
    if (!ctxAmostra) return;
    ctxAmostra.drawImage(tela, 0, 0, 32, 32);
    if (!quadroTemImagem(ctxAmostra.getImageData(0, 0, 32, 32).data)) {
      setAviso("Esta cena saiu em branco ou de uma cor só. Mexa na linha do filme e tente de novo.");
      return;
    }

    const blob = await new Promise<Blob | null>((pronto) => tela.toBlob(pronto, "image/jpeg", 0.92));
    if (!blob) {
      setAviso("Não consegui guardar o quadro. Use o quadro automático ou feche e escolha uma imagem.");
      return;
    }
    aoUsar(new File([blob], "capa.jpg", { type: "image/jpeg" }), duracao ?? undefined);
  }

  const botao = "rounded-lg border border-linha-forte px-3 py-1.5 text-xs transition hover:bg-carbon-2 disabled:opacity-50";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Escolher a cena da capa de ${nome}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={aoCancelar}
    >
      <div
        className="max-h-full w-full max-w-2xl overflow-y-auto rounded-xl border border-linha bg-carbon p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold">Escolha a cena da capa</h3>
        <p className="mt-0.5 truncate text-xs text-texto-faint" title={nome}>
          {nome}
        </p>

        <div className="mt-3 aspect-video overflow-hidden rounded-md border border-linha bg-void">
          <video
            ref={filme}
            src={url}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={aoCarregar}
            onError={() => setSemAbrir(true)}
            onSeeking={() => setBuscando(true)}
            onSeeked={() => {
              setBuscando(false);
              setAgora(filme.current?.currentTime ?? 0);
            }}
            className="h-full w-full object-contain"
          />
        </div>

        {semAbrir && !aberto ? (
          <p role="alert" className="mt-3 text-xs text-alerta">
            O navegador não conseguiu abrir este filme. Use o quadro automático, ou feche e escolha uma
            imagem (JPG ou PNG) no lugar do filme.
          </p>
        ) : !aberto ? (
          <p className="mt-3 text-xs text-texto-faint">abrindo o filme…</p>
        ) : duracao ? (
          <div className="mt-3">
            <input
              type="range"
              min={0}
              max={duracao}
              step={0.1}
              value={agora}
              onChange={(e) => irPara(Number(e.target.value))}
              aria-label="Momento do filme"
              aria-valuetext={`${relogio(agora)} de ${relogio(duracao)}`}
              className="w-full accent-acento"
            />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] tabular-nums text-texto-faint">
                {relogio(agora)} / {relogio(duracao)}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <button type="button" className={botao} onClick={() => irPara(agora - 1)}>
                  −1 s
                </button>
                <button type="button" className={botao} onClick={() => irPara(agora + 1)}>
                  +1 s
                </button>
                <button type="button" className={botao} onClick={() => irPara(sortearCena(duracao))}>
                  Cena aleatória
                </button>
              </span>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-texto-faint">
            Este arquivo não informa a duração, então não dá para escolher o momento. Use o quadro
            automático.
          </p>
        )}

        {aviso && (
          <p role="alert" className="mt-3 text-xs text-alerta">
            {aviso}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={botao} onClick={aoAutomatico}>
            Quadro automático
          </button>
          <span className="flex items-center gap-2">
            <button type="button" className={botao} onClick={aoCancelar}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={!aberto || !duracao || buscando}
              onClick={() => void usar()}
              className="rounded-lg bg-acento px-3 py-1.5 text-xs font-semibold text-void transition hover:bg-acento-alto disabled:opacity-50"
            >
              Usar esta cena
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
