"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restaurarGaleriaAction, destruirGaleriaAction } from "@/app/painel/actions";

interface Item {
  id: string;
  titulo: string;
  arquivos: number;
  diasRestantes: number;
}

/**
 * A lixeira, com as duas saídas: voltar e acabar.
 *
 * Restaurar já existia. Apagar de vez não — então "apagar" não apagava, e quem
 * precisava do espaço de volta hoje, ou tinha subido a galeria errada de um
 * cliente, não tinha caminho nenhum a não ser esperar 30 dias.
 *
 * ── POR QUE A CONFIRMAÇÃO É DIGITADA ──────────────────────────────────────
 *
 * Os dois botões ficam na mesma linha, e um deles é reversível e o outro não.
 * `confirm()` do navegador viraria um "OK" que a mão dá sozinha — e aqui o custo
 * do clique errado é o casamento inteiro, sem volta de lugar nenhum: o espelho
 * saiu em 27/08/2026, então o original tem UMA cópia.
 *
 * Digitar o nome obriga a ler qual galeria vai sumir, que é exatamente o que o
 * clique apressado pula. E o aviso diz o número de arquivos: "192 arquivos" pesa
 * diferente de "esta galeria".
 */
export function Lixeira({ itens, prazoDias }: { itens: Item[]; prazoDias: number }) {
  const [apagando, setApagando] = useState<string | null>(null);
  const [digitado, setDigitado] = useState("");
  const [enviando, iniciar] = useTransition();
  const router = useRouter();

  /*
   * ── VAZIA, ELA APARECE E SE EXPLICA (29/09/2026) ────────────────────────
   *
   * Aqui havia `return null`, com a razão escrita na página: "uma seção vazia
   * permanente ensinaria o fotógrafo a ignorar aquele canto da tela — e é
   * justamente onde ele vai precisar olhar no dia em que apagar a galeria
   * errada".
   *
   * O custo apareceu nesse mesmo dia. Uma storymaker apagou quatro FOTOS, foi
   * procurar a lixeira e não achou nem a palavra; concluiu que estava quebrado.
   * Felipe: "mas tem q permitir o usuário ver a lixeira, por que ela não está
   * vendo a lixeira?".
   *
   * A confusão dela não era só a seção sumida: era não saber que foto apagada
   * NÃO vem para cá. `apagarMedia` some com o arquivo na hora, de propósito, e
   * isso não estava dito em lugar nenhum — muito menos onde ela foi procurar.
   *
   * Então a seção fica, e vazia ela responde as duas perguntas: o que guarda, e
   * o que não guarda. O medo do comentário antigo continua endereçado — vazia
   * ela é uma linha de texto, sem borda e sem cartão, e não a mobília que se
   * aprende a ignorar.
   */
  if (itens.length === 0) {
    return (
      <section className="mt-12">
        <h2 className="text-sm font-semibold text-texto-soft">Lixeira</h2>
        <p className="mt-1 max-w-prose text-xs text-texto-faint">
          Vazia. Galeria apagada fica aqui por {prazoDias} dias e dá para restaurar inteira —
          nada sai do armazenamento antes disso. Foto apagada de dentro de uma galeria não
          passa por aqui: ela some na hora.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-12 rounded-xl border border-linha bg-carbon/40 p-5">
      <h2 className="text-sm font-semibold">Lixeira</h2>
      <p className="mt-1 text-xs text-texto-soft">
        Galerias apagadas ficam aqui por {prazoDias} dias antes de sumir de vez. Nada foi apagado do
        armazenamento ainda — restaurar traz tudo de volta.
      </p>

      <ul className="mt-4 divide-y divide-linha">
        {itens.map((g) => {
          const confere = digitado.trim() === g.titulo.trim();
          return (
            <li key={g.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{g.titulo}</span>
                  <span className="block text-xs text-texto-faint">
                    {g.arquivos} {g.arquivos === 1 ? "arquivo" : "arquivos"} ·{" "}
                    {g.diasRestantes === 0
                      ? "some hoje"
                      : `some em ${g.diasRestantes} ${g.diasRestantes === 1 ? "dia" : "dias"}`}
                  </span>
                </span>

                <span className="flex flex-wrap items-center gap-2">
                  <form action={restaurarGaleriaAction}>
                    <input type="hidden" name="galeria_id" value={g.id} />
                    <button
                      type="submit"
                      className="rounded-full border border-linha-forte px-4 py-1.5 text-xs font-medium hover:bg-carbon-2"
                    >
                      Restaurar
                    </button>
                  </form>
                  {apagando !== g.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setApagando(g.id);
                        setDigitado("");
                      }}
                      className="text-xs text-texto-faint underline underline-offset-4 transition hover:text-erro"
                    >
                      apagar de vez
                    </button>
                  )}
                </span>
              </div>

              {apagando === g.id && (
                <div className="mt-3 rounded-lg border border-erro/40 bg-erro/5 p-3">
                  <p className="text-xs leading-relaxed text-texto-soft">
                    <strong className="text-erro">Isto não tem volta.</strong> Os {g.arquivos}{" "}
                    {g.arquivos === 1 ? "arquivo sai" : "arquivos saem"} do armazenamento agora, e
                    não há segunda cópia em lugar nenhum — nem nossa, nem do fornecedor. Se o seu
                    cliente pedir estas fotos amanhã, elas não existem mais.
                  </p>
                  <p className="mt-2 text-xs text-texto-soft">
                    Para confirmar, digite o nome da galeria:{" "}
                    <strong className="text-texto">{g.titulo}</strong>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      value={digitado}
                      onChange={(e) => setDigitado(e.target.value)}
                      aria-label={`Digite ${g.titulo} para confirmar`}
                      className="min-w-0 flex-1 rounded-lg border border-linha bg-carbon px-3 py-2 text-sm text-texto placeholder:text-exemplo focus:border-erro focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={!confere || enviando}
                      onClick={() =>
                        iniciar(async () => {
                          const f = new FormData();
                          f.set("galeria_id", g.id);
                          await destruirGaleriaAction(f);
                          setApagando(null);
                          setDigitado("");
                          router.refresh();
                        })
                      }
                      className="rounded-lg border border-erro/40 px-3 py-2 text-sm text-erro transition hover:bg-erro/10 disabled:opacity-40"
                    >
                      {enviando ? "Apagando…" : "Apagar de vez"}
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
          );
        })}
      </ul>
    </section>
  );
}
