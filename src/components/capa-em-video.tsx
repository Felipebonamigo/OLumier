"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ErroDoClipe, enviarClipeDaCapa, prepararClipe, tirarClipeDaCapa } from "@/lib/clipe-da-capa";
import { DURACAO_MAXIMA_DO_CLIPE } from "@/lib/clipe-da-capa-regras";

/**
 * A CAPA EM VÍDEO do formato Stream — o clipe que toca mudo no fundo da capa.
 *
 * Juan, 08/10/2026: "adicionar opção de subir capa em VÍDEO no formato Stream".
 *
 * O fotógrafo escolhe o arquivo (o do CapCut serve); o navegador dele o refaz —
 * 720p, sem som, até 30 s — e sobe só o resultado, com o primeiro quadro em
 * imagem. Ver `lib/clipe-da-capa.ts` para o porquê de cada medida: nada do
 * filme original passa pelo servidor, e quem assiste no 4G recebe um arquivo de
 * poucos MB.
 *
 * Mora no grupo Formato, junto de "Capa do stream", porque só o Stream tem esta
 * capa. O clipe só toca quando a capa é a do próprio estilo (a tela diz isso);
 * na "capa do grupo Capa" a imagem continua parada.
 */
export function CapaEmVideo({
  galeriaId,
  quadroAtual,
  capaDoEstilo,
}: {
  galeriaId: string;
  /** O primeiro quadro do clipe que a galeria tem hoje, ou null se não tem. */
  quadroAtual: string | null;
  /** A capa do Stream é a do próprio estilo? Só assim o clipe aparece. */
  capaDoEstilo: boolean;
}) {
  const [estado, setEstado] = useState<"parado" | "preparando" | "enviando" | "tirando">("parado");
  const [fracao, setFracao] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const cancelador = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const ocupado = estado !== "parado";

  async function aoEscolher(arquivo: File) {
    setErro(null);
    setFracao(0);
    setEstado("preparando");
    const controle = new AbortController();
    cancelador.current = controle;
    try {
      const pronto = await prepararClipe(arquivo, { aoProgresso: setFracao, sinal: controle.signal });
      if (controle.signal.aborted) return;
      setEstado("enviando");
      await enviarClipeDaCapa(galeriaId, pronto);
      router.refresh();
    } catch (e) {
      if (controle.signal.aborted) return;
      setErro(
        e instanceof ErroDoClipe
          ? e.message
          : "Não deu certo preparar o clipe. Tente de novo, ou exporte o vídeo em MP4 (H.264) no editor.",
      );
    } finally {
      cancelador.current = null;
      setEstado("parado");
    }
  }

  async function tirar() {
    setErro(null);
    setEstado("tirando");
    try {
      await tirarClipeDaCapa(galeriaId);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui tirar o clipe.");
    } finally {
      setEstado("parado");
    }
  }

  return (
    <div>
      <span className="block text-xs font-medium text-texto-soft">Capa em vídeo</span>
      <p className="mt-0.5 text-[11px] leading-snug text-texto-faint">
        Um clipe de até {DURACAO_MAXIMA_DO_CLIPE} segundos que toca mudo, em laço, no fundo da capa do stream.
        Seu navegador prepara o clipe antes de subir (720p, sem som, uns poucos MB), então o filme original
        não precisa ser pequeno — mas o trecho precisa ser curto. Aparece nos estilos Cinema, Episódios e
        Vitrine (a Mostra não tem imagem de capa). Em quem pediu menos movimento, ou está com economia de
        dados, fica só o primeiro quadro.
      </p>

      <div className="mt-2 flex items-center gap-3">
        <span className="block aspect-video w-28 shrink-0 overflow-hidden rounded-md border border-linha bg-void">
          {quadroAtual ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL assinada do armazém
            <img src={quadroAtual} alt="Primeiro quadro do clipe da capa" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[11px] text-texto-faint">
              sem clipe
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-col items-start gap-1.5">
          <button
            type="button"
            disabled={ocupado}
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-linha-forte px-3 py-1.5 text-xs transition hover:bg-carbon disabled:opacity-50"
          >
            {estado === "preparando"
              ? `preparando o clipe… ${Math.round(fracao * 100)}%`
              : estado === "enviando"
                ? "enviando…"
                : quadroAtual
                  ? "Trocar o clipe"
                  : "Escolher o vídeo"}
          </button>
          {estado === "preparando" && (
            <button
              type="button"
              onClick={() => cancelador.current?.abort()}
              className="text-[11px] text-texto-faint underline underline-offset-4"
            >
              cancelar
            </button>
          )}
          {quadroAtual && !ocupado && (
            <button
              type="button"
              onClick={() => void tirar()}
              className="text-[11px] text-texto-faint underline underline-offset-4 hover:text-alerta"
            >
              tirar o clipe
            </button>
          )}
        </span>
      </div>

      {quadroAtual && !capaDoEstilo && (
        <p className="mt-2 text-[11px] leading-snug text-texto-faint">
          O clipe está guardado, mas a capa do stream agora é o desenho do grupo Capa — por isso ele não toca.
          Volte à capa do estilo (acima) para vê-lo.
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/*"
        className="hidden"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = "";
          if (arquivo) void aoEscolher(arquivo);
        }}
      />

      {erro && (
        <p role="alert" className="mt-2 text-[11px] text-alerta">
          {erro}
        </p>
      )}
    </div>
  );
}
