"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * A área de capa, dentro de Design.
 *
 * ── O PEDIDO (04/09/2026) ─────────────────────────────────────────────────
 *
 * "Adicionar uma área de selecionar capa: escolher se será de alguma galeria já
 * existente ou se será através da importação de algum arquivo."
 *
 * São duas metades, e só uma existia:
 *
 *   UMA FOTO DA GALERIA  já dava, e estava escondida — o botão "capa" mora em
 *     cada miniatura da grade, e quem não rolasse a grade não o encontrava.
 *     Aqui ele vira um caminho anunciado, com link para o lugar certo.
 *   UM ARQUIVO PRÓPRIO   não existia. Quem quisesse uma arte na capa (convite,
 *     cartão com o nome do casal) precisava subi-la como foto — e ela aparecia
 *     no meio das outras para o casal, contava como entrega e ia no "baixar
 *     tudo". Agora vai para fora de `medias`. Ver a migração 029.
 *
 * ── POR QUE O ESCOLHEDOR DE FOTO É UM LINK, E NÃO UMA GRADE AQUI ──────────
 *
 * Desenhar a grade nesta aba obrigaria o Design a carregar as mídias e assinar
 * uma miniatura por foto — 600 num casamento —, que é exatamente a carga que a
 * divisão em abas veio cortar. A grade já existe na aba Fotos, com o botão
 * "capa" em cada miniatura; o que faltava era alguém apontar para ela.
 */
export function CapaGaleriaEditor({
  galeriaId,
  urlCapaAtual,
  enviada,
}: {
  galeriaId: string;
  /** A capa que está valendo agora, seja a enviada ou a foto escolhida. */
  urlCapaAtual: string | null;
  /** true quando a capa atual é um arquivo enviado, não uma foto da galeria. */
  enviada: boolean;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"enviando" | "removendo" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function enviar(arquivo: File) {
    setErro(null);
    setOcupado("enviando");
    try {
      /* Mesmo caminho da logo e das fotos: o arquivo vai DIRETO para o bucket
         com URL assinada, sem passar pelo nosso servidor. */
      const preparo = await fetch(`/api/galerias/${galeriaId}/capa`, {
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

      const confirma = await fetch(`/api/galerias/${galeriaId}/capa`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave: dados.chave }),
      });
      const fim = await confirma.json();
      if (!confirma.ok) throw new Error(fim.erro ?? "não consegui confirmar a capa");

      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não consegui enviar a capa");
    } finally {
      setOcupado(null);
    }
  }

  async function remover() {
    setErro(null);
    setOcupado("removendo");
    try {
      const r = await fetch(`/api/galerias/${galeriaId}/capa`, { method: "DELETE" });
      if (!r.ok) throw new Error("não consegui tirar a capa");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não consegui tirar a capa");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div>
      <span className="block text-xs font-medium text-texto-soft">Foto da capa</span>

      <div className="mt-2 flex flex-wrap items-start gap-4">
        <div className="w-40 shrink-0 overflow-hidden rounded-lg border border-linha bg-void">
          {urlCapaAtual ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária
            <img src={urlCapaAtual} alt="Capa atual da galeria" className="h-24 w-full object-cover" />
          ) : (
            <span className="grid h-24 place-items-center px-2 text-center text-[11px] text-texto-faint">
              a primeira foto da galeria
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs text-texto-faint">
            {enviada
              ? "Uma imagem que você enviou só para a capa. Ela não aparece na galeria nem entra no download do cliente."
              : urlCapaAtual
                ? "Está usando uma foto da galeria."
                : "Sem escolha, a capa é a primeira foto da galeria."}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={ocupado !== null}
              onClick={() => inputRef.current?.click()}
              className="rounded-lg border border-linha-forte px-3 py-1.5 text-xs transition hover:bg-carbon-2 disabled:opacity-50"
            >
              {ocupado === "enviando" ? "enviando…" : "Enviar uma imagem"}
            </button>

            {/*
              A grade com o botão "capa" em cada miniatura já existe na aba
              Fotos. Repeti-la aqui custaria carregar as mídias e assinar uma
              miniatura por foto nesta aba — a carga que a divisão em abas veio
              cortar. Melhor apontar para onde a ferramenta já está.
            */}
            <Link
              href={`/painel/galerias/${galeriaId}/fotos`}
              className="rounded-lg border border-linha px-3 py-1.5 text-xs text-texto-soft transition hover:bg-carbon-2"
            >
              Usar uma foto da galeria
            </Link>

            {enviada && (
              <button
                type="button"
                disabled={ocupado !== null}
                onClick={remover}
                className="rounded-lg px-3 py-1.5 text-xs text-texto-faint underline underline-offset-4 transition hover:text-erro disabled:opacity-50"
              >
                {ocupado === "removendo" ? "tirando…" : "tirar a imagem enviada"}
              </button>
            )}
          </div>

          <p className="mt-2 text-[11px] text-texto-faint">PNG, JPG ou WEBP, até 8 MB.</p>
          {erro && <p className="mt-2 text-xs text-erro">{erro}</p>}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void enviar(f);
        }}
      />
    </div>
  );
}
