import type { EstiloPastas, EstiloStream, Formato } from "@/config/aparencia";

/**
 * O esquema de cada formato — uma tela em miniatura, e não um ícone.
 *
 * A estratégia de marca pede para DEMONSTRAR, não declarar (§9): "pastas" e
 * "stream" escritos numa pastilha fazem a pessoa imaginar; o desenho da tela
 * que o cliente vai ver responde antes de ela perguntar.
 *
 * Mora num arquivo próprio porque serve a DUAS telas com o mesmo desenho: o
 * grupo Formato do Design e a etapa de estilo da galeria nova. Duas amostras
 * para a mesma decisão foi o defeito que `AmostraDoPreset` já consertou uma
 * vez (25/09/2026).
 */
export function EsquemaDoFormato({ formato }: { formato: Formato }) {
  const bloco = "rounded-[2px] bg-texto-faint/30";
  if (formato === "pastas") {
    return (
      <div className="grid h-full grid-cols-3 gap-1.5 p-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="relative flex-1">
              <span className={`absolute inset-0 translate-x-[3px] -translate-y-[3px] ${bloco} opacity-50`} />
              <span className="absolute inset-0 rounded-[2px] bg-texto-faint/60" />
            </div>
            <span className={`h-1 w-3/4 ${bloco}`} />
          </div>
        ))}
      </div>
    );
  }
  if (formato === "stream") {
    return (
      <div className="flex h-full flex-col gap-1 bg-void/60 p-2" aria-hidden>
        <div className="relative flex-1 rounded-[2px] bg-texto-faint/40">
          <span className="absolute bottom-1 left-1 h-1 w-6 rounded-full bg-acento" />
        </div>
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-3 flex-1 ${bloco} ${i === 3 ? "opacity-40" : ""}`} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full grid-cols-4 gap-1 p-2" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} className={bloco} />
      ))}
    </div>
  );
}


/**
 * O esquema de cada ESTILO de pastas e de stream — a mesma ideia do esquema
 * do formato, um passo mais perto: o desenho da página que o cliente vai ver.
 * A Cinema é desenhada escura de propósito, porque ela é escura na entrega.
 */
export function EsquemaDoEstilo({ estilo }: { estilo: EstiloPastas | EstiloStream }) {
  const b = "rounded-[2px] bg-texto-faint/30";
  const f = "rounded-[2px] bg-texto-faint/60";
  switch (estilo) {
    case "pilha":
      return (
        <div className="grid h-full grid-cols-3 gap-2 p-2.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="relative">
              <span className={`absolute inset-0 -rotate-6 ${b}`} />
              <span className={`absolute inset-0 rotate-3 ${b}`} />
              <span className={`absolute inset-0 ${f}`} />
            </span>
          ))}
        </div>
      );
    case "capas":
      return (
        <div className="grid h-full grid-cols-3 gap-1.5 p-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className={`relative ${f}`}>
              <span className="absolute bottom-1.5 left-1.5 h-1 w-3/5 rounded-full bg-white/80" />
            </span>
          ))}
        </div>
      );
    case "indice":
      return (
        <div className="flex h-full flex-col justify-center gap-1.5 px-2.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex items-center gap-1.5 border-b border-texto-faint/25 pb-1">
              <span className="h-2 w-2 rounded-[1px] bg-texto-faint/40" />
              <span className="h-1.5 flex-1 rounded-full bg-texto-faint/60" />
              <span className={`h-3 w-3 ${f}`} />
              <span className={`h-3 w-2 ${b}`} />
            </span>
          ))}
        </div>
      );
    case "mosaico":
      return (
        <div className="grid h-full grid-cols-2 gap-2 p-2" aria-hidden>
          {[0, 1].map((i) => (
            <span key={i} className="grid grid-cols-3 grid-rows-2 gap-0.5">
              <span className={`col-span-2 row-span-2 ${f}`} />
              <span className={b} />
              <span className={b} />
            </span>
          ))}
        </div>
      );
    case "feed":
      /* Seis quadrados colados, e não três cartões com respiro: o desenho
         precisa mostrar a densidade, que é a razão de o estilo existir. */
      return (
        <div className="grid h-full grid-cols-3 grid-rows-2 gap-0.5 p-1.5" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className={i % 2 ? b : f} />
          ))}
        </div>
      );
    case "cinema":
      return (
        <div className="flex h-full flex-col gap-1 bg-neutral-900 p-1.5" aria-hidden>
          <span className="relative flex-1 rounded-[2px] bg-neutral-600">
            <span className="absolute bottom-1 left-1 h-1.5 w-4 rounded-[1px] bg-white" />
          </span>
          <span className="flex gap-0.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-3 flex-1 rounded-[1px] bg-neutral-600" />
            ))}
          </span>
        </div>
      );
    case "episodios":
      return (
        <div className="flex h-full flex-col gap-1 p-2" aria-hidden>
          <span className="flex gap-1.5">
            <span className={`h-7 w-12 ${f}`} />
            <span className="flex flex-1 flex-col justify-center gap-1">
              <span className="h-1.5 w-4/5 rounded-full bg-texto-faint/60" />
              <span className="h-1.5 w-6 rounded-full bg-acento" />
            </span>
          </span>
          {[0, 1].map((i) => (
            <span key={i} className="flex items-center gap-1.5 border-t border-texto-faint/25 pt-1">
              <span className={`h-3 w-5 ${b}`} />
              <span className="h-1 flex-1 rounded-full bg-texto-faint/40" />
            </span>
          ))}
        </div>
      );
    case "vitrine":
      return (
        <div className="flex h-full flex-col gap-1.5 p-2" aria-hidden>
          <span className="h-1.5 w-2/5 rounded-full bg-texto-faint/60" />
          <span className="flex-1 rounded-md bg-texto-faint/50" />
          <span className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-3 flex-1 rounded-[3px] bg-texto-faint/30" />
            ))}
          </span>
        </div>
      );
    case "mostra":
      return (
        <div className="flex h-full flex-col justify-center gap-1.5 px-2.5" aria-hidden>
          <span className="h-2.5 w-4/5 rounded-[1px] bg-texto-faint/70" />
          <span className="mt-0.5 border-t border-texto-faint/50" />
          {[0, 1].map((i) => (
            <span key={i} className="flex items-center gap-1.5 border-b border-texto-faint/25 pb-1">
              <span className="h-1 w-1.5 rounded-full bg-texto-faint/40" />
              <span className={`h-2 rounded-[1px] bg-texto-faint/60 ${i ? "w-3/5" : "w-4/5"}`} />
            </span>
          ))}
        </div>
      );
  }
}
