"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  copiarParaOutraGaleriaAction,
  galeriasParaMoverAction,
  moverParaOutraGaleriaAction,
  opcoesDoDestinoAction,
} from "@/app/painel/actions";
import { nomeDoGrupoSolto } from "@/lib/nome-de-arquivo";
import type {
  DestinoPossivel,
  EscopoDoMovimento,
  OpcoesDoDestino,
} from "@/lib/mover-entre-galerias";

/** Acima disto a lista ganha campo de busca; abaixo, é mais um campo para ignorar. */
const COM_BUSCA = 6;

const dataPorExtenso = (iso: string | null) => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
};

type Passo = "galeria" | "capitulo" | "pronto";

/** "1,2 GB", "340 MB" — só para dizer quanto espaço a cópia ocupou. */
const pesoPorExtenso = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1).replace(".", ",")} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`;

/**
 * Mover fotos para OUTRA galeria — o modal.
 *
 * ── O PEDIDO (08/10/2026) ─────────────────────────────────────────────────
 *
 * Uma aluna manda só as prévias do ensaio numa galeria e, com tudo pronto, leva
 * essas fotos para a final. "Ao invés de precisar SUBIR as fotos novamente, só
 * movemos de localização dentro da própria Galeria Átomo." Dois passos, como foi
 * pedido: primeiro QUAL galeria, depois EM QUAL capítulo — e sem capítulo
 * escolhido as fotos vão para o grupo das soltas ("Outras fotos").
 *
 * O resultado fica na tela (passo "pronto") em vez de um aviso que some: as fotos
 * saem da grade no instante em que o servidor confirma, e quem acabou de mover
 * quer ver para ONDE elas foram, com o caminho para abrir a galeria.
 *
 * ── COPIAR, NO MESMO MODAL (14/10/2026) ──────────────────────────────────
 *
 * Felipe: a galeria com todas as fotos analógicas da vida, e as fotos de cada
 * cliente também na galeria DELE — "sem catar em HD". Mesmos dois passos (qual
 * galeria, qual capítulo); muda o verbo e o que a tela promete. Copiar cria um
 * arquivo novo, que ocupa espaço de novo, e a tela diz isso ANTES do botão — o
 * contrário de mover, que não gasta nada. A cópia anda em lotes por peso (o
 * servidor devolve o que sobrou), com a contagem na tela.
 *
 * `<dialog>` de verdade, com `showModal`: Esc, foco preso e fundo inerte vêm do
 * navegador (a mesma escolha de `capa-galeria-editor.tsx`).
 */
export function MoverParaOutraGaleria({
  origemId,
  escopo,
  resumo,
  quantidade,
  modo = "mover",
  aoFechar,
}: {
  origemId: string;
  /** "mover" tira da galeria de origem; "copiar" deixa a foto nas duas (só com `escopo.tipo === "ids"`). */
  modo?: "mover" | "copiar";
  escopo: EscopoDoMovimento;
  /** O que vai ser movido, por extenso e sem artigo (foto e vídeo discordam em gênero): "12 fotos da seleção", "34 fotos de “Festa”". */
  resumo: string;
  /** Só a conta, para o botão: "12 fotos", "3 fotos · 2 vídeos". */
  quantidade: string;
  /** Chamada ao fechar; `moveu` diz se algo mudou de lugar (para limpar a seleção). */
  aoFechar: (moveu: boolean) => void;
}) {
  const caixa = useRef<HTMLDialogElement>(null);
  const idDoTitulo = useId();
  const [passo, setPasso] = useState<Passo>("galeria");
  const [galerias, setGalerias] = useState<DestinoPossivel[] | null>(null);
  const [busca, setBusca] = useState("");
  const [destino, setDestino] = useState<DestinoPossivel | null>(null);
  const [opcoes, setOpcoes] = useState<OpcoesDoDestino | null>(null);
  /* "" = sem capítulo. É o padrão, e é o que o pedido diz: sem escolha, vai
     para "Outras fotos". */
  const [secaoId, setSecaoId] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const copiando = modo === "copiar";
  const [resultado, setResultado] = useState<{ movidas: number; favoritas: number; bytes: number } | null>(null);
  const [andamento, setAndamento] = useState<{ feitas: number; total: number } | null>(null);
  const [movendo, iniciar] = useTransition();
  const moveu = useRef(false);
  /* Qual pedido de capítulos é o ATUAL: quem clica numa galeria, volta e clica
     noutra não pode receber de volta os capítulos da primeira. */
  const pedido = useRef(0);

  useEffect(() => {
    const el = caixa.current;
    if (el && !el.open) el.showModal();
  }, []);

  /* A lista de galerias só é buscada agora, na abertura: a aba Fotos é a mais
     pesada do painel e não paga por isto em toda visita. */
  useEffect(() => {
    let cancelado = false;
    galeriasParaMoverAction(origemId)
      .then((l) => !cancelado && setGalerias(l))
      .catch(() => {
        if (cancelado) return;
        setGalerias([]);
        setErro("Não consegui carregar suas galerias. Feche e tente de novo.");
      });
    return () => {
      cancelado = true;
    };
  }, [origemId]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    if (!galerias || !termo) return galerias ?? [];
    return galerias.filter((g) =>
      `${g.titulo} ${g.subtitulo ?? ""}`.toLocaleLowerCase("pt-BR").includes(termo),
    );
  }, [galerias, busca]);

  function escolherGaleria(g: DestinoPossivel) {
    setErro(null);
    setDestino(g);
    setOpcoes(null);
    setSecaoId("");
    setPasso("capitulo");
    const meu = ++pedido.current;
    opcoesDoDestinoAction(origemId, g.id)
      .then((o) => {
        if (meu !== pedido.current) return;
        if (o) setOpcoes(o);
        else {
          setErro("Essa galeria não está mais disponível.");
          setPasso("galeria");
        }
      })
      .catch(() => {
        if (meu !== pedido.current) return;
        setErro("Não consegui abrir essa galeria. Tente de novo.");
        setPasso("galeria");
      });
  }

  function mover() {
    if (!destino) return;
    setErro(null);
    iniciar(async () => {
      try {
        if (copiando) {
          if (escopo.tipo !== "ids") {
            setErro("Só dá para copiar fotos marcadas na grade.");
            return;
          }
          /* A cópia anda por peso: o servidor devolve o que sobrou, e a tela
             pede de novo até acabar. Se um lote falha, o que já foi copiado
             fica (e a mensagem diz quanto), o resto não é tentado. */
          let fila = escopo.ids;
          const total = fila.length;
          let feitas = 0;
          let bytes = 0;
          setAndamento({ feitas: 0, total });
          while (fila.length > 0) {
            const r = await copiarParaOutraGaleriaAction({
              origemId,
              destinoId: destino.id,
              secaoDestinoId: secaoId || null,
              ids: fila,
            });
            if (!r.ok) {
              setErro(
                feitas > 0
                  ? `${r.erro} Já foram copiadas ${feitas} de ${total}; as outras não foram.`
                  : r.erro,
              );
              moveu.current = feitas > 0;
              setAndamento(null);
              return;
            }
            feitas += r.copiadas;
            bytes += r.bytesCopiados;
            /* Sem progresso nem fila menor: sai, em vez de pedir para sempre. */
            if (r.copiadas === 0 && r.restantes.length >= fila.length) break;
            fila = r.restantes;
            setAndamento({ feitas, total });
          }
          setAndamento(null);
          moveu.current = feitas > 0;
          setResultado({ movidas: feitas, favoritas: 0, bytes });
          setPasso("pronto");
          return;
        }
        const r = await moverParaOutraGaleriaAction({
          origemId,
          destinoId: destino.id,
          secaoDestinoId: secaoId || null,
          escopo,
        });
        if (!r.ok) {
          setErro(r.erro);
          return;
        }
        moveu.current = r.movidas > 0;
        setResultado({ movidas: r.movidas, favoritas: r.favoritasMantidas, bytes: 0 });
        setPasso("pronto");
      } catch {
        setAndamento(null);
        setErro(
          copiando
            ? "Não foi possível copiar agora. Se algum lote já tinha passado, ele ficou na galeria — confira o destino antes de tentar de novo."
            : "Não foi possível mover agora. Nada foi alterado — tente de novo.",
        );
      }
    });
  }

  const temCapitulos = (opcoes?.capitulos.length ?? 0) > 0;
  const nomeDoDestinoFinal = !opcoes
    ? ""
    : secaoId
      ? (opcoes.capitulos.find((c) => c.id === secaoId)?.nome ?? "")
      : temCapitulos
        ? nomeDoGrupoSolto(opcoes.grupoSolto)
        : "";

  return (
    <dialog
      ref={caixa}
      aria-labelledby={idDoTitulo}
      onClose={() => aoFechar(moveu.current)}
      /* Clique no fundo (no próprio <dialog>, fora da caixa de dentro) fecha —
         menos enquanto grava, para não largar a operação sem a pessoa ver. */
      onClick={(e) => {
        if (e.target === caixa.current && !movendo) caixa.current?.close();
      }}
      className="m-auto w-[min(92vw,34rem)] max-w-none rounded-xl border border-linha bg-carbon p-0 text-texto backdrop:bg-black/60"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={idDoTitulo} className="text-sm font-semibold">
              {passo === "pronto"
                ? copiando
                  ? "Fotos copiadas"
                  : "Fotos movidas"
                : copiando
                  ? "Copiar para outra galeria"
                  : "Mover para outra galeria"}
            </h2>
            <p className="mt-0.5 text-xs text-texto-faint">
              {passo === "galeria" && `${resumo} — para qual galeria?`}
              {passo === "capitulo" && destino && `${resumo} → ${destino.titulo}`}
              {passo === "pronto" &&
                destino &&
                `${copiando ? "Agora também em" : "Agora em"} “${destino.titulo}”.`}
            </p>
          </div>
          <button
            type="button"
            disabled={movendo}
            onClick={() => caixa.current?.close()}
            className="shrink-0 rounded-lg border border-linha px-3 py-1.5 text-xs transition hover:bg-carbon-2 disabled:opacity-40"
          >
            {passo === "pronto" ? "Fechar" : "Cancelar"}
          </button>
        </div>

        {erro && (
          <p role="alert" className="mt-3 rounded-lg border border-erro/40 bg-erro/10 px-3 py-2 text-xs text-erro">
            {erro}
          </p>
        )}

        {/* ── 1. QUAL GALERIA ───────────────────────────────────────────── */}
        {passo === "galeria" && (
          <div className="mt-4">
            {galerias === null ? (
              <p role="status" className="py-6 text-center text-xs text-texto-faint">
                carregando suas galerias…
              </p>
            ) : galerias.length === 0 ? (
              !erro && (
                <p className="rounded-lg border border-linha bg-carbon-2 px-4 py-5 text-center text-xs text-texto-soft">
                  Você não tem outra galeria no ar para receber estas fotos. Crie a galeria de
                  destino primeiro — galerias arquivadas ou na lixeira não aparecem aqui.
                </p>
              )
            ) : (
              <>
                {galerias.length > COM_BUSCA && (
                  <input
                    type="search"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="buscar galeria pelo nome…"
                    aria-label="Buscar galeria"
                    className="mb-2 w-full rounded-lg border border-linha bg-void px-3 py-2 text-xs focus:border-acento focus:outline-none"
                  />
                )}
                <ul className="max-h-[50vh] divide-y divide-linha overflow-y-auto rounded-lg border border-linha">
                  {visiveis.map((g) => {
                    const data = dataPorExtenso(g.dataEvento);
                    return (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => escolherGaleria(g)}
                          className="block w-full px-3 py-2.5 text-left transition hover:bg-carbon-2 focus:bg-carbon-2 focus:outline-none"
                        >
                          <span className="block truncate text-sm font-medium">{g.titulo}</span>
                          <span className="block truncate text-[11px] text-texto-faint">
                            {[g.subtitulo, data, `${g.total} ${g.total === 1 ? "arquivo" : "arquivos"}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {visiveis.length === 0 && (
                    <li className="px-3 py-4 text-center text-xs text-texto-faint">
                      nenhuma galeria com esse nome
                    </li>
                  )}
                </ul>
              </>
            )}
          </div>
        )}

        {/* ── 2. EM QUAL CAPÍTULO ───────────────────────────────────────── */}
        {passo === "capitulo" && destino && (
          <div className="mt-4">
            <button
              type="button"
              disabled={movendo}
              onClick={() => {
                pedido.current++;
                setErro(null);
                setPasso("galeria");
              }}
              className="text-[11px] text-texto-faint underline decoration-dotted underline-offset-2 transition hover:text-acento disabled:opacity-40"
            >
              ← escolher outra galeria
            </button>

            {opcoes === null ? (
              <p role="status" className="py-6 text-center text-xs text-texto-faint">
                abrindo a galeria…
              </p>
            ) : (
              <>
                <fieldset className="mt-3" disabled={movendo}>
                  <legend className="text-xs font-medium">
                    {temCapitulos ? "Em qual capítulo?" : "Capítulo"}
                  </legend>
                  <ul className="mt-2 max-h-[40vh] divide-y divide-linha overflow-y-auto rounded-lg border border-linha">
                    <li>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition hover:bg-carbon-2 has-[:checked]:bg-carbon-2">
                        <input
                          type="radio"
                          name="capitulo-de-destino"
                          checked={secaoId === ""}
                          onChange={() => setSecaoId("")}
                          className="accent-acento"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            {temCapitulos ? nomeDoGrupoSolto(opcoes.grupoSolto) : "Todas as fotos"}
                          </span>
                          <span className="block text-[11px] text-texto-faint">
                            {temCapitulos
                              ? "sem capítulo — é para onde vão se você não escolher outro"
                              : "esta galeria não tem capítulos: as fotos entram na sequência"}
                          </span>
                        </span>
                      </label>
                    </li>
                    {opcoes.capitulos.map((c) => (
                      <li key={c.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition hover:bg-carbon-2 has-[:checked]:bg-carbon-2">
                          <input
                            type="radio"
                            name="capitulo-de-destino"
                            checked={secaoId === c.id}
                            onChange={() => setSecaoId(c.id)}
                            className="accent-acento"
                          />
                          <span className="min-w-0 flex-1 truncate">{c.nome}</span>
                          <span className="shrink-0 text-[11px] text-texto-faint">
                            {c.total} {c.total === 1 ? "arquivo" : "arquivos"}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>

                <p className="mt-3 text-[11px] text-texto-faint">
                  As fotos entram no fim{temCapitulos ? " do capítulo" : " da galeria"}, na mesma ordem em
                  que estão agora.{" "}
                  {copiando
                    ? "Elas continuam também nesta galeria. Cada cópia é um arquivo novo: não sobe de novo, mas ocupa espaço de novo no seu plano."
                    : "O arquivo não sobe de novo e continua ocupando o mesmo espaço."}
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                  <span className="mr-auto text-[11px] text-texto-faint">
                    {nomeDoDestinoFinal && `vão para “${nomeDoDestinoFinal}”`}
                  </span>
                  <button
                    type="button"
                    disabled={movendo}
                    onClick={mover}
                    className="rounded-lg bg-acento px-4 py-2 text-xs font-semibold text-void transition hover:opacity-90 disabled:opacity-50"
                  >
                    {movendo
                      ? copiando
                        ? andamento
                          ? `copiando ${andamento.feitas} de ${andamento.total}…`
                          : "copiando…"
                        : "movendo…"
                      : `${copiando ? "Copiar" : "Mover"} ${quantidade}`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── 3. FEITO ──────────────────────────────────────────────────── */}
        {passo === "pronto" && destino && resultado && (
          <div className="mt-4">
            <p role="status" className="text-sm">
              {resultado.movidas === 0
                ? copiando
                  ? "Nenhuma foto foi copiada — elas já não estão mais aqui."
                  : "Nenhuma foto foi movida — elas já não estão mais aqui."
                : `${resultado.movidas} ${
                    copiando
                      ? resultado.movidas === 1 ? "arquivo copiado" : "arquivos copiados"
                      : resultado.movidas === 1 ? "arquivo movido" : "arquivos movidos"
                  } para “${destino.titulo}”${nomeDoDestinoFinal ? ` · ${nomeDoDestinoFinal}` : ""}.`}
            </p>
            {copiando && resultado.bytes > 0 && (
              <p className="mt-1 text-[11px] text-texto-faint">
                As cópias ocupam mais {pesoPorExtenso(resultado.bytes)} do seu espaço. As originais
                seguem em “esta galeria”.
              </p>
            )}
            {resultado.favoritas > 0 && (
              <p className="mt-1 text-[11px] text-texto-faint">
                {resultado.favoritas === 1
                  ? "1 marcação de favorita veio junto"
                  : `${resultado.favoritas} marcações de favorita vieram junto`}
                : quem escolheu por e-mail reencontra as dela ao se identificar nesta galeria.
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Link
                href={`/painel/galerias/${destino.id}/fotos`}
                className="rounded-lg bg-acento px-4 py-2 text-xs font-semibold text-void transition hover:opacity-90"
              >
                Abrir “{destino.titulo}”
              </Link>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
