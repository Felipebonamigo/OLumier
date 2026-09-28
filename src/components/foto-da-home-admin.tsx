"use client";
/* eslint-disable @next/next/no-img-element -- prévia no admin: a foto sai da
 * mesma rota que a home usa, e é essa que precisa aparecer aqui. */

import { useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { gerarDerivadas } from "@/lib/derivadas-client";
import type { FotoDemo, LugarDaHome } from "@/config/home-demonstracao";

/**
 * UM LUGAR DA PÁGINA INICIAL, na tela do admin: a foto de agora, onde ela
 * aparece, e o que dá para fazer com ela.
 *
 * A troca segue o caminho do envio de uma galeria: o navegador gera as duas
 * derivadas (`gerarDerivadas` — 2048 px para capa e foto do fim, 640 px para
 * a grade), manda as duas DIRETO para o bucket e só então confirma na API.
 * O original não sai do computador.
 *
 * O FOCO é o ponto que a capa larga mantém no recorte. Foto vertical numa
 * capa de galeria perde a maior parte da altura, e o centro geométrico
 * costuma cair no peito das pessoas: um toque no rosto resolve. A tira
 * embaixo mostra o recorte como ele fica.
 */
export function FotoDaHomeAdmin({
  lugar,
  nome,
  onde,
  foto,
  trocada,
}: {
  lugar: LugarDaHome;
  nome: string;
  onde: string[];
  foto: FotoDemo;
  /** Quando e quem trocou. `null` = é a foto padrão do site. */
  trocada: { quando: string; quem: string | null } | null;
}) {
  const router = useRouter();
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [descricao, setDescricao] = useState(foto.descricao);
  const [foco, setFoco] = useState({ x: foto.focoX, y: foto.focoY });

  async function pedir(metodo: "POST" | "PUT" | "PATCH" | "DELETE", corpo: object = {}) {
    const r = await fetch("/api/admin/home/foto", {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lugar, ...corpo }),
    });
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(dados.erro ?? "Não foi possível salvar.");
    return dados;
  }

  async function trocar(arquivo: File) {
    setErro(null);
    setAviso(null);
    try {
      setOcupado("Preparando a foto…");
      const d = await gerarDerivadas(arquivo);
      if (!d?.preview) throw new Error("Não consegui abrir esta foto. Envie JPG, PNG ou WEBP.");
      if (d.preview.type !== "image/webp" || d.thumb.type !== "image/webp") {
        throw new Error("Este navegador não conseguiu preparar a foto. Tente pelo Chrome.");
      }

      setOcupado("Enviando…");
      const urls = await pedir("POST");
      /* O tipo vai escrito, e não `blob.type`: a URL foi assinada para WebP,
         e qualquer outro valor no cabeçalho invalida a assinatura. */
      const subir = async (url: string, blob: Blob) => {
        const r = await fetch(url, { method: "PUT", headers: { "Content-Type": "image/webp" }, body: blob });
        if (!r.ok) throw new Error("O envio para o armazenamento falhou.");
      };
      await Promise.all([subir(urls.foto.url, d.preview), subir(urls.miniatura.url, d.thumb)]);

      setOcupado("Confirmando…");
      /* A descrição da foto anterior não descreve esta: começa vazia, e o
         aviso embaixo pede uma nova. */
      await pedir("PUT", {
        chave: urls.foto.chave,
        chaveMiniatura: urls.miniatura.chave,
        largura: d.largura,
        altura: d.altura,
        descricao: "",
        focoX: 50,
        focoY: 50,
      });
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível trocar a foto.");
    } finally {
      setOcupado(null);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  async function ajustar(corpo: { descricao?: string; focoX?: number; focoY?: number }, feito: string) {
    setErro(null);
    try {
      await pedir("PATCH", corpo);
      setAviso(feito);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar.");
    }
  }

  function marcarFoco(e: MouseEvent<HTMLImageElement>) {
    if (!trocada || ocupado) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 100);
    const y = Math.round(((e.clientY - r.top) / r.height) * 100);
    setFoco({ x, y });
    void ajustar({ focoX: x, focoY: y }, "Foco salvo.");
  }

  async function voltarAoPadrao() {
    if (!confirm(`Voltar "${nome}" para a foto padrão do site? A foto enviada é apagada.`)) return;
    setErro(null);
    setOcupado("Voltando…");
    try {
      await pedir("DELETE");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível voltar à padrão.");
    } finally {
      setOcupado(null);
    }
  }

  const botao =
    "rounded-lg border border-linha-forte px-3 py-2 text-sm transition hover:bg-carbon-2 disabled:opacity-40";

  return (
    <li className="flex flex-col rounded-xl border border-linha bg-carbon p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">{nome}</h3>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${
            trocada ? "border-ok/40 bg-ok/10 text-ok" : "border-linha text-texto-faint"
          }`}
        >
          {trocada ? "trocada" : "padrão do site"}
        </span>
      </div>
      <ul className="mt-1 space-y-0.5 text-xs text-texto-soft">
        {onde.map((o) => (
          <li key={o}>· {o}</li>
        ))}
      </ul>

      <div className="mt-3 flex h-56 items-center justify-center rounded-lg bg-void p-2">
        <span className="relative inline-block">
          <img
            src={foto.src}
            alt={foto.descricao}
            onClick={marcarFoco}
            className={`block max-h-52 max-w-full rounded ${trocada ? "cursor-crosshair" : ""}`}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.6)]"
            style={{ left: `${foco.x}%`, top: `${foco.y}%` }}
          />
        </span>
      </div>
      <p className="mt-2 text-[11px] text-texto-faint">
        {trocada
          ? "Toque na foto para marcar o foco — o ponto que a capa larga não corta."
          : "O foco da foto padrão vem do site."}
      </p>
      <div className="mt-2 aspect-[5/2] overflow-hidden rounded bg-void">
        <img
          src={foto.src}
          alt=""
          className="h-full w-full object-cover"
          style={{ objectPosition: `${foco.x}% ${foco.y}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-texto-faint">Recorte numa capa larga</p>

      {trocada ? (
        <div className="mt-3">
          <label className="block text-xs text-texto-soft" htmlFor={`descricao-${lugar}`}>
            O que a foto mostra
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id={`descricao-${lugar}`}
              value={descricao}
              maxLength={200}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="ex.: noivos caminhando no jardim"
              className="min-w-0 flex-1 rounded-lg border border-linha bg-void px-3 py-2 text-sm placeholder:text-exemplo focus:border-acento focus:outline-none"
            />
            <button
              type="button"
              className={botao}
              disabled={Boolean(ocupado) || descricao.trim() === foto.descricao}
              onClick={() => ajustar({ descricao }, "Descrição salva.")}
            >
              Salvar
            </button>
          </div>
          {!foto.descricao && (
            <p className="mt-1 text-[11px] text-alerta">
              Sem descrição. É o que o leitor de tela lê no lugar da foto, e o que o Google entende dela.
            </p>
          )}
          <p className="mt-2 text-[11px] text-texto-faint">
            Trocada em {trocada.quando}
            {trocada.quem ? ` por ${trocada.quem}` : ""}.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-texto-soft">{foto.descricao}</p>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <input
          ref={arquivoRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void trocar(f);
          }}
        />
        <button
          type="button"
          disabled={Boolean(ocupado)}
          onClick={() => arquivoRef.current?.click()}
          className="rounded-lg bg-acento px-3 py-2 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:opacity-40"
        >
          {ocupado ?? "Trocar foto"}
        </button>
        {trocada && (
          <button type="button" disabled={Boolean(ocupado)} onClick={voltarAoPadrao} className={botao}>
            Voltar à padrão
          </button>
        )}
      </div>
      {erro && (
        <p role="alert" className="mt-2 text-xs text-erro">
          {erro}
        </p>
      )}
      {aviso && !erro && (
        <p role="status" className="mt-2 text-xs text-ok">
          {aviso}
        </p>
      )}
    </li>
  );
}
