"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";

/**
 * O VÍDEO QUE NÃO ABRE TEM DE DIZER QUE NÃO ABRIU (08/10/2026).
 *
 * Felipe, na galeria do Mirna e Diogo: "os vídeos abrem e nem executam". Os 32
 * arquivos eram `.MOV` do iPhone em HEVC, de 13 a 54 Mbps. Onde o navegador não
 * decodifica HEVC (Firefox, boa parte dos Chrome de computador) o `<video>`
 * fica parado no pôster — ou, pior, toca o SOM com a tela preta, porque o áudio
 * AAC ele abre. Onde decodifica, 54 Mbps não passam num 4G e o filme não sai do
 * lugar. Nos três casos a pessoa via um player que parecia quebrado e nenhuma
 * palavra.
 *
 * Este arquivo não conserta o arquivo (isso é a versão leve, ver
 * `lib/versao-leve.ts`); ele conserta o SILÊNCIO. Três sinais:
 *
 *  · `error` no elemento — formato que o navegador recusa;
 *  · `loadeddata` com `videoWidth === 0` — abriu o som, não a imagem;
 *  · esperando mais de `PACIENCIA_MS` depois do play sem um quadro andar —
 *    pesado demais para a conexão.
 *
 * Os dois primeiros são "não abre neste aparelho"; o terceiro é "está
 * demorando", e não tira o vídeo da tela: pode ser só uma rede ruim que
 * melhora. Em todos, se a galeria deixa baixar, o botão de baixar está ali —
 * o arquivo baixado abre no player do aparelho, que decodifica HEVC onde o
 * navegador não decodifica.
 */

/** Quanto tempo de "carregando" depois do play vira aviso. */
export const PACIENCIA_MS = 10_000;

export type SaudeDoVideo = "ok" | "lento" | "falhou";

/**
 * Os eventos que o `<video>` precisa repassar, e o estado que sai deles.
 *
 * `chave` é o id do item: trocar de vídeo zera tudo — o aviso de um filme não
 * pode ficar em cima do próximo.
 */
export function useSaudeDoVideo(chave: string) {
  const [saude, setSaude] = useState<SaudeDoVideo>("ok");
  const [dispensado, setDispensado] = useState(false);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parar = useCallback(() => {
    if (relogio.current) clearTimeout(relogio.current);
    relogio.current = null;
  }, []);

  /* Zerar ao trocar de item é ajuste de estado durante a renderização — o
     padrão do React para "estado que depende de prop" (sem efeito em cascata). */
  const [chaveAtual, setChaveAtual] = useState(chave);
  if (chaveAtual !== chave) {
    setChaveAtual(chave);
    setSaude("ok");
    setDispensado(false);
  }
  useEffect(() => parar, [chave, parar]);

  const esperar = useCallback(() => {
    if (relogio.current) return;
    relogio.current = setTimeout(() => {
      relogio.current = null;
      setSaude((s) => (s === "ok" ? "lento" : s));
    }, PACIENCIA_MS);
  }, []);

  const andou = useCallback(() => {
    parar();
    setSaude((s) => (s === "lento" ? "ok" : s));
  }, [parar]);

  const eventos = {
    onError: () => {
      parar();
      setSaude("falhou");
    },
    onLoadedData: (e: SyntheticEvent<HTMLVideoElement>) => {
      /* Som sem imagem: o navegador abriu o contêiner e o áudio, e não tem
         decodificador para o vídeo. */
      if (e.currentTarget.videoWidth === 0) {
        /* E cala: som de um filme que não se vê, atrás do aviso, só confunde. */
        e.currentTarget.pause();
        parar();
        setSaude("falhou");
      }
    },
    onPlay: (e: SyntheticEvent<HTMLVideoElement>) => {
      /* O `autoPlay` pode começar DEPOIS do `loadeddata` que já pausou. */
      const v = e.currentTarget;
      if (v.readyState >= 2 && v.videoWidth === 0) {
        v.pause();
        parar();
        setSaude("falhou");
        return;
      }
      esperar();
    },
    onWaiting: esperar,
    onPlaying: andou,
    onTimeUpdate: (e: SyntheticEvent<HTMLVideoElement>) => {
      if (e.currentTarget.currentTime > 0) andou();
    },
    onPause: parar,
  };

  return {
    saude: dispensado && saude === "lento" ? ("ok" as const) : saude,
    eventos,
    dispensar: () => setDispensado(true),
  };
}

/**
 * O recado, por cima do vídeo.
 *
 * `tom` é de onde ele aparece: a tela cheia da galeria usa as cores do tema
 * (`--g-*`); o Stream é sempre escuro, como uma sala de cinema.
 */
export function AvisoDoVideo({
  saude,
  baixar,
  dispensar,
  tom = "galeria",
}: {
  saude: SaudeDoVideo;
  /** ausente quando a galeria não deixa baixar */
  baixar?: () => void;
  dispensar: () => void;
  tom?: "galeria" | "escuro";
}) {
  if (saude === "ok") return null;
  const cores =
    tom === "escuro"
      ? { background: "rgba(0,0,0,0.78)", color: "#fff", borderColor: "rgba(255,255,255,0.25)" }
      : {
          background: "color-mix(in srgb, var(--g-fundo) 88%, transparent)",
          color: "var(--g-texto)",
          borderColor: "var(--g-linha)",
        };
  const falhou = saude === "falhou";
  return (
    <div
      role="status"
      className={
        falhou
          ? "absolute inset-0 z-10 grid place-items-center p-6"
          : "pointer-events-none absolute inset-x-0 bottom-16 z-10 flex justify-center p-4"
      }
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="pointer-events-auto max-w-sm rounded-2xl border px-5 py-4 text-center text-sm backdrop-blur"
        style={cores}
      >
        <p className="font-medium">
          {falhou ? "Este vídeo não abre neste navegador." : "O vídeo está demorando para carregar."}
        </p>
        <p className="mt-1 text-xs opacity-75">
          {falhou
            ? baixar
              ? "Baixe o arquivo para assistir no player do seu aparelho."
              : "Tente abrir a galeria em outro navegador ou aparelho."
            : baixar
              ? "Ele é pesado para esta conexão. Dá para esperar ou baixar o arquivo."
              : "Ele é pesado para esta conexão. Vale esperar mais um pouco."}
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {baixar && (
            <button
              type="button"
              onClick={baixar}
              className="rounded-full border px-4 py-1.5 text-xs transition hover:opacity-70"
              style={{ borderColor: cores.borderColor }}
            >
              Baixar o vídeo
            </button>
          )}
          {!falhou && (
            <button
              type="button"
              onClick={dispensar}
              className="rounded-full px-4 py-1.5 text-xs opacity-75 transition hover:opacity-100"
            >
              Continuar esperando
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
