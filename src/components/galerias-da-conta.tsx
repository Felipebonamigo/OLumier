"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apagarGaleriaAction } from "@/app/painel/actions";

interface Item {
  id: string;
  titulo: string;
  slug: string;
  estado: string;
  arquivos: number;
  bytes: number;
}

function tamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

/**
 * As galerias do estúdio, com o apagar à mão.
 *
 * O botão já existia dentro de CADA galeria, no fim da página. Quem quisesse
 * limpar meia dúzia abria seis páginas e rolava seis vezes — e o mais provável
 * era desistir e deixar tudo lá, ocupando espaço pago.
 *
 * ── A CONFIRMAÇÃO DIGITADA, E POR QUE NÃO É CHATICE ───────────────────────
 *
 * Aqui as galerias estão empilhadas e os botões ficam a poucos pixels uns dos
 * outros. `confirm()` do navegador seria um clique em "OK" que a mão dá sozinha
 * — e o alvo do clique errado é a entrega de um casamento.
 *
 * Digitar o nome obriga a LER qual galeria está prestes a sumir, que é
 * exatamente a informação que o clique apressado pula. É a mesma razão pela qual
 * apagar repositório no GitHub pede o nome.
 *
 * Apagar aqui é o mesmo `apagarGaleriaAction` da tela da galeria: manda para a
 * LIXEIRA, onde fica 30 dias. Nada é destruído neste clique — e o texto diz
 * isso, porque um aviso mais assustador do que a verdade ensina a ignorar
 * avisos.
 */
export function GaleriasDaConta({ galerias }: { galerias: Item[] }) {
  const [apagando, setApagando] = useState<string | null>(null);
  const [digitado, setDigitado] = useState("");
  const [enviando, iniciar] = useTransition();
  const router = useRouter();

  if (galerias.length === 0) {
    return (
      <section className="mt-6 rounded-xl border border-linha bg-carbon p-5">
        <h2 className="text-sm font-semibold">Galerias</h2>
        <p className="mt-1 text-xs text-texto-faint">
          Nenhuma galeria ainda. Elas aparecem aqui conforme você cria.
        </p>
      </section>
    );
  }

  const alvo = galerias.find((g) => g.id === apagando) ?? null;
  const confere = alvo != null && digitado.trim() === alvo.titulo.trim();

  return (
    <section className="mt-6 rounded-xl border border-linha bg-carbon p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Galerias</h2>
        <span className="text-xs text-texto-faint">
          {galerias.length} {galerias.length === 1 ? "galeria" : "galerias"}
        </span>
      </div>
      <p className="mt-1 text-xs text-texto-faint">
        Apagar manda para a lixeira, onde fica 30 dias antes de sumir de verdade.
      </p>

      <ul className="mt-4 divide-y divide-linha border-t border-linha">
        {galerias.map((g) => (
          <li key={g.id} className="py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <Link
                href={`/painel/galerias/${g.id}`}
                className="text-sm font-medium hover:text-acento"
              >
                {g.titulo}
              </Link>
              <div className="flex items-center gap-3 text-xs text-texto-faint">
                <span className="tabular-nums">
                  {g.arquivos} {g.arquivos === 1 ? "arquivo" : "arquivos"} · {tamanho(g.bytes)}
                </span>
                {g.estado === "lixeira" ? (
                  <span className="text-texto-faint">na lixeira</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setApagando(g.id);
                      setDigitado("");
                    }}
                    className="text-erro underline underline-offset-4 hover:text-erro/80"
                  >
                    apagar
                  </button>
                )}
              </div>
            </div>

            {apagando === g.id && (
              <div className="mt-3 rounded-lg border border-erro/40 bg-erro/5 p-3">
                <p className="text-xs leading-relaxed text-texto-soft">
                  Para confirmar, digite o nome da galeria:{" "}
                  <strong className="text-texto">{g.titulo}</strong>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={digitado}
                    onChange={(e) => setDigitado(e.target.value)}
                    aria-label={`Digite ${g.titulo} para confirmar`}
                    className="min-w-0 flex-1 rounded-lg border border-linha bg-carbon px-3 py-2 text-sm text-texto focus:border-erro focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={!confere || enviando}
                    onClick={() =>
                      iniciar(async () => {
                        const f = new FormData();
                        f.set("galeria_id", g.id);
                        await apagarGaleriaAction(f);
                        setApagando(null);
                        setDigitado("");
                        router.refresh();
                      })
                    }
                    className="rounded-lg border border-erro/40 px-3 py-2 text-sm text-erro transition hover:bg-erro/10 disabled:opacity-40"
                  >
                    {enviando ? "Apagando…" : "Apagar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setApagando(null)}
                    className="text-xs text-texto-faint underline underline-offset-4 hover:text-texto"
                  >
                    cancelar
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
