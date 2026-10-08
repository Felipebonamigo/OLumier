"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { videosParaPrepararAction } from "@/app/painel/actions";
import { prepararVideoParaAssistir } from "@/lib/versao-leve";
import { useAvisoDeSaida } from "@/lib/aviso-de-saida-client";

/**
 * PREPARAR PARA ASSISTIR OS VÍDEOS QUE JÁ SUBIRAM (08/10/2026).
 *
 * A versão leve nasce no envio (`envio-em-curso.tsx`); este botão é para o que
 * subiu antes dela existir — como os 32 vídeos do Mirna e Diogo. O navegador lê
 * o ORIGINAL do armazém aos pedaços, converte e sobe a cópia, um vídeo por vez.
 * O fotógrafo não precisa ter o arquivo no computador.
 *
 * Vídeo sem capa ganha uma, tirada da própria cópia (H.264 abre em todo
 * navegador, até onde o original não abriu).
 *
 * Vídeo que já toca bem é conferido e pulado em segundos (só o índice é lido).
 * Por isso apertar de novo é seguro: o que já tem cópia nem entra na lista, e o
 * que não precisa sai de novo como "já toca bem".
 */

type Linha = { id: string; nome: string; estado: string; motivo?: string; progresso?: number };

export function PrepararVideos({ galeriaId, faltam }: { galeriaId: string; faltam: number }) {
  const router = useRouter();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const parar = useRef<AbortController | null>(null);

  useAvisoDeSaida(
    rodando,
    "Os vídeos estão sendo preparados. Se sair agora, os que faltam continuam tocando o original.",
  );

  const mudar = (id: string, m: Partial<Linha>) =>
    setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, ...m } : l)));

  async function comecar() {
    setErro(null);
    setRodando(true);
    const controle = new AbortController();
    parar.current = controle;
    try {
      const videos = await videosParaPrepararAction(galeriaId);
      setLinhas(videos.map((v) => ({ id: v.id, nome: v.nome, estado: "fila" })));
      for (const v of videos) {
        if (controle.signal.aborted) break;
        let ultimo = -1;
        mudar(v.id, { estado: "convertendo", progresso: 0 });
        const r = await prepararVideoParaAssistir(v.id, v.url, {
          bytes: v.bytes,
          semCapa: v.semCapa,
          sinal: controle.signal,
          aoProgresso: (f) => {
            const pct = Math.floor(f * 100);
            if (pct === ultimo) return;
            ultimo = pct;
            mudar(v.id, { progresso: pct });
          },
        });
        mudar(v.id, { estado: r.estado, motivo: r.motivo });
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para começar.");
    } finally {
      setRodando(false);
      parar.current = null;
      router.refresh();
    }
  }

  const prontas = linhas.filter((l) => l.estado === "pronta").length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {rodando ? (
          <button
            type="button"
            onClick={() => parar.current?.abort()}
            className="rounded-lg border border-linha px-3 py-1.5 text-xs text-texto-soft transition hover:bg-carbon-2"
          >
            Parar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void comecar()}
            disabled={faltam === 0}
            className="rounded-lg border border-acento px-3 py-1.5 text-xs text-acento-alto transition hover:bg-acento/10 disabled:opacity-50"
          >
            {faltam === 0
              ? "Todos os vídeos estão prontos"
              : `Preparar ${faltam === 1 ? "o vídeo" : `os ${faltam} vídeos`} para assistir`}
          </button>
        )}
        {linhas.length > 0 && !rodando && (
          <span className="text-xs text-texto-faint">
            {prontas} {prontas === 1 ? "preparado" : "preparados"} agora
          </span>
        )}
      </div>
      {erro && <p className="mt-2 text-xs text-erro">{erro}</p>}
      {linhas.length > 0 && (
        <ul className="mt-3 flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1 text-xs">
          {linhas.map((l) => (
            <li key={l.id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 flex-1 truncate">{l.nome}</span>
              <span className="shrink-0 tabular-nums">
                <Situacao linha={l} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Situacao({ linha }: { linha: Linha }) {
  switch (linha.estado) {
    case "fila":
      return <span className="text-texto-faint">na fila</span>;
    case "convertendo":
      return <span className="text-texto-faint">preparando {linha.progresso ?? 0}%</span>;
    case "pronta":
      return <span className="text-ok">pronto para assistir</span>;
    case "dispensada":
      return <span className="text-texto-faint">já toca bem</span>;
    default:
      return (
        <span className="text-alerta" title={linha.motivo}>
          não deu: {linha.motivo}
        </span>
      );
  }
}
