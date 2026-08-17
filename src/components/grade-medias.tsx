"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { definirCapaAction, moverMediasAction } from "@/app/painel/actions";

export interface MediaExibida {
  id: string;
  nome: string;
  tipo: "foto" | "video";
  url: string;
  bytes: number;
  secaoId: string | null;
}

export interface SecaoOpcao {
  id: string;
  nome: string;
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
  secoes,
}: {
  medias: MediaExibida[];
  galeriaId: string;
  capaId: string | null;
  secoes: SecaoOpcao[];
}) {
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [definindoCapa, setDefinindoCapa] = useState<string | null>(null);
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  const alternarSelecao = (id: string) =>
    setSelecao((s) => {
      const nova = new Set(s);
      if (nova.has(id)) nova.delete(id);
      else nova.add(id);
      return nova;
    });

  function moverPara(secaoId: string) {
    const ids = [...selecao];
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("media_ids", ids.join(","));
      // A action trata vazio como "tirar do capítulo".
      f.set("secao_id", secaoId === "__nenhum" ? "" : secaoId);
      await moverMediasAction(f);
      setSelecao(new Set());
      router.refresh();
    });
  }

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

  const nomeSecao = (id: string | null) =>
    id ? (secoes.find((s) => s.id === id)?.nome ?? null) : null;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          {medias.length} {medias.length === 1 ? "arquivo" : "arquivos"}
        </h2>
        {selecao.size === 0 && secoes.length > 0 && (
          <span className="text-xs text-texto-faint">
            Clique na bolinha para selecionar e mover para um capítulo
          </span>
        )}
      </div>

      {/* Barra de ações em lote — só aparece com algo selecionado. */}
      {selecao.size > 0 && (
        <div className="sticky top-2 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-luz/40 bg-carbon-2 px-3 py-2.5 shadow-lg">
          <span className="text-sm font-medium">
            {selecao.size} {selecao.size === 1 ? "selecionada" : "selecionadas"}
          </span>
          <button
            type="button"
            onClick={() => setSelecao(new Set(medias.map((m) => m.id)))}
            className="rounded-md border border-linha px-2.5 py-1 text-xs text-texto-soft transition hover:bg-carbon"
          >
            todas
          </button>
          <button
            type="button"
            onClick={() => setSelecao(new Set())}
            className="rounded-md border border-linha px-2.5 py-1 text-xs text-texto-soft transition hover:bg-carbon"
          >
            limpar
          </button>

          <span className="ml-auto flex flex-wrap items-center gap-2">
            <label className="text-xs text-texto-soft" htmlFor="mover-para">
              mover para
            </label>
            <select
              id="mover-para"
              disabled={ocupado}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value !== "") moverPara(e.target.value);
                e.target.value = "";
              }}
              className="rounded-md border border-linha bg-void px-2 py-1.5 text-xs focus:border-luz focus:outline-none"
            >
              <option value="" disabled>
                escolha o capítulo…
              </option>
              {secoes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
              <option value="__nenhum">— sem capítulo —</option>
            </select>
          </span>
        </div>
      )}

      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {medias.map((m) => {
          const selecionada = selecao.has(m.id);
          const capitulo = nomeSecao(m.secaoId);
          return (
            <li key={m.id} className="group relative">
              <div
                className={`aspect-[4/5] overflow-hidden rounded-lg border bg-carbon-2 transition ${
                  selecionada ? "border-luz ring-2 ring-luz/40" : "border-linha"
                }`}
              >
                {m.tipo === "foto" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
                  <img
                    src={m.url}
                    alt={m.nome}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <video src={m.url} className="h-full w-full object-cover" preload="metadata" controls />
                )}
              </div>

              {/* Bolinha de seleção — sempre visível, para ficar óbvio que dá para selecionar. */}
              <button
                type="button"
                onClick={() => alternarSelecao(m.id)}
                aria-label={`${selecionada ? "Desmarcar" : "Selecionar"} ${m.nome}`}
                aria-pressed={selecionada}
                className={`absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border text-[11px] transition ${
                  selecionada
                    ? "border-luz bg-luz text-void"
                    : "border-linha-forte bg-void/70 text-transparent hover:text-texto-faint"
                }`}
              >
                ✓
              </button>

              {capaId === m.id && (
                <span className="absolute left-9 top-1.5 rounded-md bg-luz px-2 py-0.5 text-[10px] font-semibold text-void">
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

              <div className="mt-1.5 flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[11px] text-texto-faint">
                  {capitulo ?? m.nome}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-texto-faint">
                  {formatar(m.bytes)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
