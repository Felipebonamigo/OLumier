"use client";

import { useEffect, useRef, useState } from "react";
import { ErroDoClipe, prepararClipe, type ClipePronto } from "@/lib/clipe-da-capa";
import { DURACAO_MAXIMA_DO_CLIPE } from "@/lib/clipe-da-capa-regras";

/**
 * A CAPA EM VÍDEO NA HORA DE MONTAR A GALERIA (08/10/2026).
 *
 * Felipe, com o reel de uma capa em vídeo — o vídeo ocupa a tela e, ao rolar,
 * vem a galeria: "coloque essa opção na hora de montar a galeria".
 *
 * Aqui só se ESCOLHE e se PREPARA o clipe. Quem o sobe é o assistente, depois que
 * a galeria existe — o envio precisa do id dela (`enviarClipeDaCapa`). Por isso
 * o preparo acontece já, com a barra andando e o primeiro quadro à vista: o
 * fotógrafo vê o que vai ser a capa antes de criar, e o "Criar galeria" só espera
 * o envio (poucos MB), e não a conversão.
 *
 * É a mesma máquina do grupo Capa do Design (`capa-em-video.tsx`): o mesmo
 * `prepararClipe`, as mesmas medidas, as mesmas mensagens. Opcional, como as
 * outras etapas — e desfeito com um clique, aqui ou em Design → Capa.
 */
export function CapaEmVideoNaCriacao({
  aoMudar,
}: {
  /** O clipe pronto, ou null quando não há (ou foi tirado). O assistente o guarda. */
  aoMudar: (clipe: ClipePronto | null, preparando: boolean) => void;
}) {
  const [fracao, setFracao] = useState(0);
  const [estado, setEstado] = useState<"vazio" | "preparando" | "pronto">("vazio");
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState<{ quadro: string; duracao: number; mb: number } | null>(null);
  const cancelador = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* O endereço local do primeiro quadro nasce ao preparar e é revogado ao
     trocar ou sair. */
  useEffect(() => () => void (pronto && URL.revokeObjectURL(pronto.quadro)), [pronto]);

  async function aoEscolher(arquivo: File) {
    setErro(null);
    setFracao(0);
    setEstado("preparando");
    aoMudar(null, true);
    const controle = new AbortController();
    cancelador.current = controle;
    try {
      const clipe = await prepararClipe(arquivo, { aoProgresso: setFracao, sinal: controle.signal });
      if (controle.signal.aborted) return;
      setPronto({
        quadro: URL.createObjectURL(clipe.quadro),
        duracao: clipe.duracao,
        mb: clipe.clipe.size / (1024 * 1024),
      });
      setEstado("pronto");
      aoMudar(clipe, false);
    } catch (e) {
      if (controle.signal.aborted) return;
      setErro(
        e instanceof ErroDoClipe
          ? e.message
          : "Não deu certo preparar o clipe. Tente de novo, ou exporte o vídeo em MP4 (H.264) no editor.",
      );
      setEstado("vazio");
      aoMudar(null, false);
    } finally {
      cancelador.current = null;
    }
  }

  function tirar() {
    setPronto(null);
    setEstado("vazio");
    setErro(null);
    aoMudar(null, false);
  }

  return (
    <fieldset className="mt-5 max-w-3xl">
      <legend className="text-xs font-medium text-texto-soft">Capa em vídeo (opcional)</legend>
      <p className="mt-0.5 text-[11px] leading-snug text-texto-faint">
        Um clipe de até {DURACAO_MAXIMA_DO_CLIPE} segundos que toca mudo, em laço, ocupando a tela toda; ao
        rolar, vem a galeria. A galeria nasce com a capa Imersa e a altura “Tela toda” — o resto do estilo
        continua o que você escolher. Seu navegador prepara o clipe (720p, sem som, uns poucos MB). Dá para
        pôr, trocar ou tirar depois, em Design → Capa.
      </p>

      <div className="mt-2 flex items-center gap-3">
        <span className="block aspect-video w-28 shrink-0 overflow-hidden rounded-md border border-linha bg-void">
          {pronto ? (
            // eslint-disable-next-line @next/next/no-img-element -- endereço local do navegador
            <img src={pronto.quadro} alt="Primeiro quadro do clipe da capa" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[11px] text-texto-faint">
              sem clipe
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-col items-start gap-1.5">
          <button
            type="button"
            disabled={estado === "preparando"}
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-linha-forte px-3 py-1.5 text-xs transition hover:bg-carbon disabled:opacity-50"
          >
            {estado === "preparando"
              ? `preparando o clipe… ${Math.round(fracao * 100)}%`
              : estado === "pronto"
                ? "Escolher outro vídeo"
                : "Escolher o vídeo"}
          </button>
          {estado === "preparando" && (
            <button
              type="button"
              onClick={() => {
                cancelador.current?.abort();
                setEstado("vazio");
                aoMudar(null, false);
              }}
              className="text-[11px] text-texto-faint underline underline-offset-4"
            >
              cancelar
            </button>
          )}
          {estado === "pronto" && pronto && (
            <>
              <span className="text-[11px] text-ok">
                pronto · {Math.round(pronto.duracao)} s · {pronto.mb.toFixed(1).replace(".", ",")} MB
              </span>
              <button
                type="button"
                onClick={tirar}
                className="text-[11px] text-texto-faint underline underline-offset-4 hover:text-alerta"
              >
                tirar o clipe
              </button>
            </>
          )}
        </span>
      </div>

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
    </fieldset>
  );
}
