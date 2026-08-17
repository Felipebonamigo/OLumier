"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { definirCapaAction } from "@/app/painel/actions";

export interface MediaExibida {
  id: string;
  nome: string;
  tipo: "foto" | "video";
  url: string;
  bytes: number;
}

const formatar = (b: number) => {
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB"];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
};

export function GradeMedias({
  medias,
  galeriaId,
  capaId,
}: {
  medias: MediaExibida[];
  galeriaId: string;
  capaId: string | null;
}) {
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [definindoCapa, setDefinindoCapa] = useState<string | null>(null);
  const router = useRouter();

  async function definirCapa(m: MediaExibida) {
    setDefinindoCapa(m.id);
    try {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("media_id", m.id);
      await definirCapaAction(f);
      router.refresh();
    } finally {
      setDefinindoCapa(null);
    }
  }

  async function remover(m: MediaExibida) {
    if (!confirm(`Remover “${m.nome}”? Não dá para desfazer.`)) return;
    setRemovendo(m.id);
    try {
      const r = await fetch(`/api/medias/${m.id}/confirmar`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      router.refresh();
    } catch {
      alert("Não foi possível remover agora. Tente de novo.");
    } finally {
      setRemovendo(null);
    }
  }

  if (medias.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">
        {medias.length} {medias.length === 1 ? "arquivo" : "arquivos"}
      </h2>

      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {medias.map((m) => (
          <li key={m.id} className="group relative">
            <div className="aspect-[4/5] overflow-hidden rounded-lg border border-linha bg-carbon-2">
              {m.tipo === "foto" ? (
                // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária; o otimizador do Next não a aceita
                <img
                  src={m.url}
                  alt={m.nome}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <video
                  src={m.url}
                  className="h-full w-full object-cover"
                  preload="metadata"
                  controls
                />
              )}
            </div>

            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] text-texto-faint">{m.nome}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-texto-faint">
                {formatar(m.bytes)}
              </span>
            </div>

            {capaId === m.id && (
              <span className="absolute left-1.5 top-1.5 rounded-md bg-luz px-2 py-0.5 text-[10px] font-semibold text-void">
                capa
              </span>
            )}

            <span className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
              {m.tipo === "foto" && capaId !== m.id && (
                <button
                  type="button"
                  onClick={() => definirCapa(m)}
                  disabled={definindoCapa === m.id}
                  aria-label={`Usar ${m.nome} como capa`}
                  className="rounded-md bg-void/80 px-2 py-1 text-[11px] text-texto disabled:opacity-50"
                >
                  {definindoCapa === m.id ? "…" : "capa"}
                </button>
              )}
              <button
                type="button"
                onClick={() => remover(m)}
                disabled={removendo === m.id}
                aria-label={`Remover ${m.nome}`}
                className="rounded-md bg-void/80 px-2 py-1 text-[11px] text-texto disabled:opacity-50"
              >
                {removendo === m.id ? "…" : "remover"}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
