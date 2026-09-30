import type { Formato } from "@/config/aparencia";

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

