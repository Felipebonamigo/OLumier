/**
 * QUEM BAIXOU O QUÊ — uma linha por download.
 *
 * Juan, 23/09/2026, com a foto da tela do Pixieset: "gostaria de saber quem
 * está baixando. Quais fotos estão sendo baixadas. Existe alguma forma de fazer
 * isso?"
 *
 * A tela que ele mandou tem quatro colunas: quem, a miniatura, o nome do
 * arquivo e quando. É o que está aqui, na mesma ordem, porque essa ordem
 * responde a pergunta na sequência em que ela é feita.
 *
 * ── "NÃO IDENTIFICADO" APARECE, E É DE PROPÓSITO ─────────────────────────
 *
 * Todo download anterior a 23/09/2026 não tem dono, e o zip que o casal baixou
 * antes de a porta existir também não. Esconder essas linhas faria a lista
 * discordar do contador de downloads logo acima — e entre dois números nossos
 * que discordam, o fotógrafo acredita no menor e conclui que o resto sumiu.
 */
"use client";

import { useState } from "react";
import { FUSO } from "@/config/fuso";

export interface LinhaDeDownload {
  id: string;
  quando: string;
  /** `true` quando é o zip da galeria inteira, que não é sobre uma foto. */
  tudo: boolean;
  quem: string;
  identificado: boolean;
  arquivo: string | null;
  url: string | null;
}

const POR_VEZ = 50;

const quandoLegivel = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: FUSO,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function ListaDeDownloads({ linhas }: { linhas: LinhaDeDownload[] }) {
  /* Mostrar 50 e "ver mais": uma galeria entregue a um casamento inteiro passa
     de mil downloads, e mil miniaturas assinadas de uma vez é a mesma conta que
     estourou o Safari da Carol em 11/09/2026. */
  const [quantas, setQuantas] = useState(POR_VEZ);

  if (linhas.length === 0) {
    return (
      <div className="mt-8 rounded-xl border border-linha bg-carbon p-5">
        <h2 className="text-sm font-semibold">Quem baixou</h2>
        <p className="mt-2 text-xs text-texto-faint">
          Ninguém baixou nada ainda. Quando alguém baixar, aparece aqui quem foi, qual foto e
          quando.
        </p>
      </div>
    );
  }

  const visiveis = linhas.slice(0, quantas);

  return (
    <div className="mt-8 rounded-xl border border-linha bg-carbon p-5">
      <h2 className="flex items-baseline gap-2.5 text-sm font-semibold">
        Quem baixou
        <span className="text-xs font-normal tabular-nums text-texto-faint">{linhas.length}</span>
      </h2>
      <p className="mt-0.5 text-xs text-texto-faint">
        Cada download, do mais recente para o mais antigo.
      </p>

      <ul className="mt-4 divide-y divide-linha rounded-lg border border-linha">
        {visiveis.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
            {/* A miniatura antes do nome do arquivo: o fotógrafo reconhece a
                foto pela imagem, não por "sirius-danisergiop-128.jpg". */}
            {l.url ? (
              /* eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporária */
              <img
                src={l.url}
                alt=""
                className="h-10 w-10 shrink-0 rounded object-cover"
                loading="lazy"
              />
            ) : (
              <span
                aria-hidden
                className="grid h-10 w-10 shrink-0 place-items-center rounded border border-linha text-[10px] text-texto-faint"
              >
                {l.tudo ? "zip" : "—"}
              </span>
            )}

            <span className="min-w-[10rem] flex-1">
              <span
                className={`block truncate text-sm ${
                  l.identificado ? "font-medium" : "italic text-texto-faint"
                }`}
              >
                {l.quem}
              </span>
              <span className="block truncate text-[11px] text-texto-faint">
                {l.tudo ? "a galeria inteira (.zip)" : (l.arquivo ?? "foto apagada depois")}
              </span>
            </span>

            <span className="shrink-0 text-[11px] tabular-nums text-texto-faint">
              {quandoLegivel(l.quando)}
            </span>
          </li>
        ))}
      </ul>

      {quantas < linhas.length && (
        <button
          type="button"
          onClick={() => setQuantas((q) => q + POR_VEZ)}
          className="mt-3 w-full rounded-lg border border-linha px-3 py-2 text-xs text-texto-soft transition hover:border-acento hover:text-texto"
        >
          ver mais {Math.min(POR_VEZ, linhas.length - quantas)} de {linhas.length - quantas}
        </button>
      )}
    </div>
  );
}
