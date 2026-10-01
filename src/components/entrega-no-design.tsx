"use client";

import { useEffect, useState, useTransition } from "react";
import {
  definirCapaDaPastaAction,
  fotosDaPastaAction,
  renomearVideoAction,
} from "@/app/painel/actions";
import type { FotoDaPasta, PastaNoDesign, VideoNoDesign } from "@/lib/entrega-no-design";

/**
 * O CONTEÚDO DAS PASTAS E DO STREAM, NO DESIGN (30/09/2026).
 *
 * Os nomes dos vídeos e as capas das pastas não são aparência: não passam pelo
 * rascunho nem pelo "Publicar". São dados da entrega, como o nome de um
 * capítulo — gravam na hora, e a prévia recarrega sozinha (a assinatura da
 * prévia, em `design/page.tsx`, inclui os dois).
 *
 * Moram aqui, e não na aba Fotos, porque é aqui que o fotógrafo está olhando
 * a prévia do formato — ver `lib/entrega-no-design.ts`.
 */

/** Os nomes dos vídeos, um campo por vídeo, com o pôster ao lado. */
export function NomesDosVideos({
  galeriaId,
  videos,
  aoGravar,
}: {
  galeriaId: string;
  videos: VideoNoDesign[];
  aoGravar: () => void;
}) {
  if (videos.length === 0) return null;
  return (
    <div>
      <span className="block text-xs font-medium text-texto-soft">Nome de cada vídeo</span>
      <p className="mt-0.5 text-[11px] leading-snug text-texto-faint">
        É o nome que o cliente vê no Stream. Vazio usa o nome do arquivo. O arquivo baixado continua
        com o nome original.
      </p>
      <ul className="mt-2 divide-y divide-linha rounded-lg border border-linha">
        {videos.map((v) => (
          <NomeDoVideo key={v.id} galeriaId={galeriaId} video={v} aoGravar={aoGravar} />
        ))}
      </ul>
    </div>
  );
}

function NomeDoVideo({
  galeriaId,
  video,
  aoGravar,
}: {
  galeriaId: string;
  video: VideoNoDesign;
  aoGravar: () => void;
}) {
  const [valor, setValor] = useState(video.titulo ?? "");
  const [gravado, setGravado] = useState(video.titulo ?? "");
  const [estado, setEstado] = useState<"" | "gravando" | "ok" | "erro">("");
  const [, iniciar] = useTransition();

  function gravar() {
    const limpo = valor.replace(/\s+/g, " ").trim();
    if (limpo === gravado) return;
    setEstado("gravando");
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("media_id", video.id);
      f.set("titulo", limpo);
      const r = await renomearVideoAction(f);
      if (!r.ok) {
        setEstado("erro");
        return;
      }
      setValor(limpo);
      setGravado(limpo);
      setEstado("ok");
      aoGravar();
    });
  }

  return (
    <li className="flex items-center gap-3 p-2">
      <span className="block aspect-video w-20 shrink-0 overflow-hidden rounded bg-carbon-2">
        {video.poster && (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém
          <img src={video.poster} alt="" className="h-full w-full object-cover" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <input
          value={valor}
          onChange={(e) => {
            setValor(e.target.value.slice(0, 120));
            setEstado("");
          }}
          onBlur={gravar}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Escape") setValor(gravado);
          }}
          maxLength={120}
          placeholder={video.doArquivo}
          aria-label={`Nome do vídeo ${video.nomeDoArquivo}`}
          className="w-full rounded-md border border-linha bg-void px-2.5 py-1.5 text-sm text-texto placeholder:text-texto-faint focus:border-acento focus:outline-none"
        />
        <span className="mt-1 flex gap-2 truncate text-[10px] text-texto-faint">
          <span className="truncate">
            {video.nomeDoArquivo}
            {video.capitulo ? ` · ${video.capitulo}` : ""}
          </span>
          <span
            role="status"
            className={`ml-auto shrink-0 ${estado === "erro" ? "text-alerta" : "text-texto-faint"}`}
          >
            {estado === "gravando" ? "gravando…" : estado === "ok" ? "gravado" : estado === "erro" ? "não gravou" : ""}
          </span>
        </span>
      </span>
    </li>
  );
}

/**
 * A capa de cada pasta: o cartão de cada capítulo com a capa de hoje, e as
 * fotos dele para escolher outra — carregadas só quando a pasta é aberta.
 */
export function CapasDasPastas({
  galeriaId,
  pastas,
  aoGravar,
}: {
  galeriaId: string;
  pastas: PastaNoDesign[];
  aoGravar: () => void;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  if (pastas.length === 0) {
    return (
      <p className="text-[11px] leading-snug text-texto-faint">
        Quando a galeria tiver capítulos com fotos, a capa de cada pasta se escolhe aqui.
      </p>
    );
  }
  return (
    <div>
      <span className="block text-xs font-medium text-texto-soft">Capa de cada pasta</span>
      <p className="mt-0.5 text-[11px] leading-snug text-texto-faint">
        Sem escolha, a capa é a primeira foto do capítulo. As fotos fora de capítulo formam uma pasta
        com a primeira delas.
      </p>
      <ul className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-3">
        {pastas.map((p) => {
          const ativa = aberta === p.secaoId;
          return (
            <li key={p.secaoId}>
              <button
                type="button"
                aria-expanded={ativa}
                onClick={() => setAberta(ativa ? null : p.secaoId)}
                className={`group block w-full overflow-hidden rounded-lg border text-left transition ${
                  ativa ? "border-acento" : "border-linha hover:border-acento"
                }`}
              >
                <span className="relative block aspect-[4/3] bg-carbon-2">
                  {p.capa && (
                    // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém
                    <img src={p.capa} alt="" className="h-full w-full object-cover" />
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-[10px] text-white/85">
                    {p.escolhida ? "capa escolhida" : "primeira foto"}
                  </span>
                </span>
                <span className="flex items-baseline justify-between gap-2 px-2 py-1.5">
                  <span className="truncate text-xs font-medium">{p.nome}</span>
                  <span className="shrink-0 text-[10px] text-acento-alto">
                    {ativa ? "fechar" : "trocar"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {aberta && (
        <FotosParaCapa
          key={aberta}
          galeriaId={galeriaId}
          pasta={pastas.find((p) => p.secaoId === aberta) as PastaNoDesign}
          escolher={() => {
            setAberta(null);
            aoGravar();
          }}
        />
      )}
    </div>
  );
}

function FotosParaCapa({
  galeriaId,
  pasta,
  escolher,
}: {
  galeriaId: string;
  pasta: PastaNoDesign;
  escolher: () => void;
}) {
  const [fotos, setFotos] = useState<FotoDaPasta[] | null>(null);
  const [mais, setMais] = useState(false);
  const [erro, setErro] = useState("");
  const [ocupado, iniciar] = useTransition();

  function carregar(desde: number) {
    iniciar(async () => {
      try {
        const r = await fotosDaPastaAction(galeriaId, pasta.secaoId, desde);
        setFotos((atual) => [...(atual ?? []), ...r.fotos]);
        setMais(r.mais);
      } catch {
        setErro("Não consegui carregar as fotos. Tente de novo.");
      }
    });
  }

  /* A primeira página, ao abrir. A `key` do pai remonta o componente ao
     trocar de pasta, então isto roda uma vez por pasta aberta. */
  useEffect(() => {
    let vivo = true;
    fotosDaPastaAction(galeriaId, pasta.secaoId, 0)
      .then((r) => {
        if (!vivo) return;
        setFotos(r.fotos);
        setMais(r.mais);
      })
      .catch(() => vivo && setErro("Não consegui carregar as fotos. Tente de novo."));
    return () => {
      vivo = false;
    };
  }, [galeriaId, pasta.secaoId]);

  function usar(id: string) {
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("media_id", id);
      const r = await definirCapaDaPastaAction(f);
      if (!r.ok) {
        setErro("Não consegui trocar a capa. Tente de novo.");
        return;
      }
      escolher();
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-linha p-3">
      <span className="block text-xs text-texto-soft">
        Escolha a capa de <strong className="text-texto">{pasta.nome}</strong>
      </span>
      {erro && <p className="mt-2 text-xs text-alerta">{erro}</p>}
      {fotos === null ? (
        <p className="mt-2 text-[11px] text-texto-faint">carregando as fotos…</p>
      ) : (
        <>
          <ul className="mt-2 grid max-h-80 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6">
            {fotos.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => usar(f.id)}
                  className="block aspect-square w-full overflow-hidden rounded border border-transparent transition hover:border-acento disabled:opacity-60"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém */}
                  <img src={f.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
          {mais && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => carregar(fotos.length)}
              className="mt-2 text-[11px] text-acento-alto underline underline-offset-4 disabled:opacity-60"
            >
              mostrar mais fotos
            </button>
          )}
        </>
      )}
    </div>
  );
}
