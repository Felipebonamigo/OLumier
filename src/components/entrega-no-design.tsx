"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { definirCapaDaPastaAction, fotosDaPastaAction } from "@/app/painel/actions";
import { CampoDoNomeDoVideo } from "@/components/nome-do-video";
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
  return (
    <li className="flex items-center gap-3 p-2">
      <span className="block aspect-video w-20 shrink-0 overflow-hidden rounded bg-carbon-2">
        {video.poster && (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém
          <img src={video.poster} alt="" className="h-full w-full object-cover" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <CampoDoNomeDoVideo
          galeriaId={galeriaId}
          mediaId={video.id}
          titulo={video.titulo}
          doArquivo={video.doArquivo}
          nomeDoArquivo={video.nomeDoArquivo}
          aoGravar={aoGravar}
        />
        <span className="block truncate text-[10px] text-texto-faint">
          {video.nomeDoArquivo}
          {video.capitulo ? ` · ${video.capitulo}` : ""}
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
        Clique num capítulo para enviar uma imagem ou escolher uma das fotos dele. Sem escolha, a capa
        é a primeira foto do capítulo. As fotos fora de capítulo formam uma pasta com a primeira delas.
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
                    {p.enviada ? "imagem enviada" : p.escolhida ? "capa escolhida" : "primeira foto"}
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
  const [enviando, setEnviando] = useState(false);
  const arquivoRef = useRef<HTMLInputElement | null>(null);
  const rotaDaCapa = `/api/galerias/${galeriaId}/secoes/${pasta.secaoId}/capa`;

  /*
   * O arquivo vai DIRETO do navegador para o bucket com URL assinada — mesmo
   * caminho da capa da galeria, da logo e das fotos. O servidor só prepara e
   * confirma, e confere na confirmação o que REALMENTE chegou.
   */
  async function enviarArquivo(arquivo: File) {
    setErro("");
    setEnviando(true);
    try {
      const preparo = await fetch(rotaDaCapa, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mime: arquivo.type, bytes: arquivo.size }),
      });
      const dados = await preparo.json();
      if (!preparo.ok) throw new Error(dados.erro ?? "não consegui preparar o envio");

      const subida = await fetch(dados.url, {
        method: "PUT",
        headers: { "Content-Type": arquivo.type },
        body: arquivo,
      });
      if (!subida.ok) throw new Error("o arquivo não chegou ao armazenamento");

      const confirma = await fetch(rotaDaCapa, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave: dados.chave }),
      });
      const fim = await confirma.json();
      if (!confirma.ok) throw new Error(fim.erro ?? "não consegui confirmar a capa");
      escolher();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não consegui enviar a imagem");
    } finally {
      setEnviando(false);
    }
  }

  async function tirarEnviada() {
    setErro("");
    setEnviando(true);
    try {
      const r = await fetch(rotaDaCapa, { method: "DELETE" });
      if (!r.ok) throw new Error("não consegui tirar a imagem");
      escolher();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não consegui tirar a imagem");
    } finally {
      setEnviando(false);
    }
  }

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
        A capa de <strong className="text-texto">{pasta.nome}</strong>
      </span>
      {/*
        ── ENVIAR UMA IMAGEM QUE NÃO É DA ENTREGA (01/10/2026) ───────────────

        Juan: "enviar uma nova foto ou escolher uma da galeria". A segunda metade
        é a grade abaixo, e existia. Esta é a primeira: uma arte com o nome do
        capítulo, um convite, um frame tratado — imagem que o casal NÃO deve
        encontrar no meio das fotos dele.

        Fica ACIMA da grade porque é o pedido novo, e porque quem já sabe qual
        foto quer rola três centímetros; quem quer subir um arquivo e não acha o
        botão desiste.
      */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={ocupado || enviando}
          onClick={() => arquivoRef.current?.click()}
          className="rounded-md border border-linha px-2.5 py-1.5 text-xs transition hover:border-acento disabled:opacity-60"
        >
          {enviando ? "enviando…" : "Enviar uma imagem"}
        </button>
        {pasta.enviada && (
          <button
            type="button"
            disabled={ocupado || enviando}
            onClick={tirarEnviada}
            className="text-[11px] text-texto-faint underline underline-offset-4 transition hover:text-alerta disabled:opacity-60"
          >
            tirar a imagem enviada
          </button>
        )}
        <span className="text-[11px] text-texto-faint">PNG, JPG ou WEBP, até 8 MB</span>
      </div>
      <input
        ref={arquivoRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void enviarArquivo(f);
        }}
      />
      <span className="mt-3 block text-xs text-texto-soft">Ou escolha uma foto do capítulo</span>
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
