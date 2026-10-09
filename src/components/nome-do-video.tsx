"use client";

import { useState, useTransition } from "react";
import { renomearVideoAction } from "@/app/painel/actions";

/**
 * O CAMPO DO NOME DE UM VÍDEO — o que o cliente lê no Stream (08/10/2026).
 *
 * Juan: "adicionar possibilidade de trocar o nome do vídeo, pois está
 * aparecendo o nome completo que vem do CapCut" (`copy 60CA8324-795C-…`). O
 * campo já existia desde 30/09, mas só dentro do Design → Formato → Stream —
 * e quem procurava o nome do vídeo estava na aba Vídeo. Agora é o mesmo campo
 * nos dois lugares, e este arquivo é o único que sabe gravar.
 *
 * Grava ao sair do campo (ou Enter), fora do rascunho do Design: é dado da
 * entrega, como o nome de um capítulo. Vazio devolve o nome tirado do arquivo
 * (`definirTituloDoVideo`). O arquivo baixado continua com o nome original.
 */
export function CampoDoNomeDoVideo({
  galeriaId,
  mediaId,
  titulo,
  doArquivo,
  nomeDoArquivo,
  rotulo,
  aoGravar,
}: {
  galeriaId: string;
  mediaId: string;
  /** O nome escrito pelo fotógrafo, ou null. */
  titulo: string | null;
  /** O que o Stream mostra enquanto o campo está vazio. */
  doArquivo: string;
  nomeDoArquivo: string;
  /** Um rótulo visível acima do campo (a aba Vídeo usa; a lista do Design não). */
  rotulo?: string;
  aoGravar?: () => void;
}) {
  const [valor, setValor] = useState(titulo ?? "");
  const [gravado, setGravado] = useState(titulo ?? "");
  const [estado, setEstado] = useState<"" | "gravando" | "ok" | "erro">("");
  const [, iniciar] = useTransition();

  function gravar() {
    const limpo = valor.replace(/\s+/g, " ").trim();
    if (limpo === gravado) return;
    setEstado("gravando");
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("media_id", mediaId);
      f.set("titulo", limpo);
      const r = await renomearVideoAction(f);
      if (!r.ok) {
        setEstado("erro");
        return;
      }
      setValor(limpo);
      setGravado(limpo);
      setEstado("ok");
      aoGravar?.();
    });
  }

  return (
    <span className="block min-w-0">
      {rotulo && <span className="mb-1 block text-[11px] font-medium text-texto-soft">{rotulo}</span>}
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
        placeholder={doArquivo}
        aria-label={`Nome do vídeo ${nomeDoArquivo}`}
        className="w-full rounded-md border border-linha bg-void px-2.5 py-1.5 text-sm text-texto placeholder:text-texto-faint focus:border-acento focus:outline-none"
      />
      <span role="status" className={`mt-1 block h-3 text-[10px] ${estado === "erro" ? "text-alerta" : "text-texto-faint"}`}>
        {estado === "gravando" ? "gravando…" : estado === "ok" ? "gravado" : estado === "erro" ? "não gravou" : ""}
      </span>
    </span>
  );
}
