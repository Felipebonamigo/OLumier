"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * O CLIPE DA CAPA — vídeo mudo em laço por cima da imagem (08/10/2026).
 *
 * Juan: "adicionar opção de subir capa em VÍDEO no formato Stream" — e Felipe,
 * no mesmo dia, mostrando uma capa Imersa em movimento: "tem como fazermos uma
 * capa de galeria de vídeo assim?". Serve às duas: a sala do Stream e as capas
 * Imersa e Cartaz da galeria comum. A imagem
 * embaixo é o primeiro quadro do próprio clipe, então nada "pula" quando ele
 * começa; o clipe só se junta a ela depois de montar, porque preferência do
 * navegador não existe no servidor.
 *
 * Quando NÃO toca, e a imagem fica sozinha:
 *   · `prefers-reduced-motion`: movimento de fundo é o caso de livro;
 *   · economia de dados (`saveData`): o clipe é o único peso que a capa tem;
 *   · o clipe falhou em carregar (`onError`);
 *   · fora da tela ou com o player aberto por cima — pausa, e a bateria agradece.
 *
 * `muted` + `playsInline` + `autoPlay` é a combinação que o iPhone e o Chrome
 * aceitam tocar sozinha. Sem som, sem controles, e fora do alcance do teclado.
 */
export function ClipeDaCapa({
  src,
  parado = false,
  className = "",
  style,
}: {
  src: string | null | undefined;
  /** Algo por cima pede o clipe parado (o player aberto, por exemplo). */
  parado?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const [pode, setPode] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [visivel, setVisivel] = useState(true);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const economia = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       As preferências do navegador só existem depois de montar; ver acima. */
    setPode(!reduzir && !economia);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !pode || typeof IntersectionObserver === "undefined") return;
    const olho = new IntersectionObserver(([e]) => setVisivel(e.isIntersecting), { threshold: 0.05 });
    olho.observe(el);
    return () => olho.disconnect();
  }, [pode, src]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (parado || !visivel) el.pause();
    else void el.play().catch(() => {});
  }, [parado, visivel, pode]);

  if (!src || !pode || falhou) return null;
  return (
    <video
      ref={ref}
      src={src}
      muted
      loop
      autoPlay
      playsInline
      preload="auto"
      disablePictureInPicture
      disableRemotePlayback
      aria-hidden
      tabIndex={-1}
      onError={() => setFalhou(true)}
      style={style}
      className={`pointer-events-none block object-cover ${className}`}
    />
  );
}
