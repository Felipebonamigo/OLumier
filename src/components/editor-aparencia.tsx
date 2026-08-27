"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  OPCOES,
  PRESETS,
  presetEquivalente,
  FONTES_TITULO,
  type Aparencia,
} from "@/config/aparencia";
import { salvarAparenciaAction } from "@/app/painel/actions";

/**
 * Editor de aparência com prévia ao vivo.
 *
 * A prévia é a própria galeria pública num iframe — não uma imitação. O que ele
 * vê aqui é literalmente o que o cliente vai receber, e nenhuma variante pode
 * "parecer certa no editor e sair errada no link".
 */
/**
 * As peças do editor moram FORA do componente de propósito.
 *
 * Definidas dentro dele, eram recriadas a cada renderização: o React via um tipo
 * de componente NOVO toda vez, desmontava a árvore e montava outra. Perde foco,
 * perde estado interno e refaz trabalho à toa — é o que a regra
 * `react-hooks/static-components` acusava, e ela estava certa.
 *
 * O preço é passar `ap` e `mudar` por prop, o que de quebra deixa a dependência
 * visível em vez de escondida no fechamento.
 */
interface PecaProps {
  ap: Aparencia;
  mudar: (novo: Aparencia) => void;
}

/**
 * O seletor de fonte.
 *
 * Não usa o `Eixo` genérico por dois motivos, e os dois são sobre a decisão
 * que o fotógrafo está tomando:
 *
 *   1. Cada nome é DESENHADO NA PRÓPRIA FONTE. "Playfair" escrito em
 *      Montserrat não ajuda ninguém a escolher Playfair — a amostra é a
 *      informação, o nome é só a etiqueta.
 *
 *   2. Agrupado por família. Nove pastilhas soltas viram uma parede; com
 *      Serifadas, Sem serifa e Manuscritas separadas, quem já sabe o clima
 *      que quer olha só um terço da lista.
 *
 * O texto de amostra é o nome da fonte e não "Aa": num alfabeto de duas
 * letras, manuscrita e serifada se parecem demais.
 */
function SeletorDeFonte({ ap, mudar }: PecaProps) {
  const familias = [...new Set(OPCOES.tipografia.map((o) => o.familia))];
  return (
    <div className="sm:col-span-2">
      <span className="block text-xs font-medium text-texto-soft">Fonte do título</span>
      <div className="mt-2 flex flex-col gap-3">
        {familias.map((familia) => (
          <div key={familia}>
            <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-texto-faint">
              {familia}
            </span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {OPCOES.tipografia
                .filter((o) => o.familia === familia)
                .map((op) => {
                  const ativo = ap.tipografia === op.id;
                  return (
                    <button
                      key={op.id}
                      type="button"
                      title={op.desc}
                      aria-pressed={ativo}
                      onClick={() => mudar({ ...ap, tipografia: op.id })}
                      style={{ fontFamily: FONTES_TITULO[op.id] }}
                      className={`rounded-lg border px-3.5 py-2 text-base leading-none transition ${
                        ativo
                          ? "border-acento bg-acento/10 text-acento-alto"
                          : "border-linha text-texto-soft hover:border-linha-forte hover:text-texto"
                      }`}
                    >
                      {op.nome}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Eixo<K extends keyof Aparencia>({
eixo,
titulo,
ap,
mudar,
}: PecaProps & { eixo: K; titulo: string }) {
return (
  <div>
    <span className="block text-xs font-medium text-texto-soft">{titulo}</span>
    <div className="mt-2 flex flex-wrap gap-1.5">
      {OPCOES[eixo].map((op) => {
        const ativo = ap[eixo] === op.id;
        return (
          <button
            key={op.id}
            type="button"
            title={op.desc}
            onClick={() => mudar({ ...ap, [eixo]: op.id } as Aparencia)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              ativo
                ? "border-acento bg-acento/10 text-acento-alto"
                : "border-linha text-texto-soft hover:border-linha-forte hover:text-texto"
            }`}
          >
            {op.nome}
          </button>
        );
      })}
    </div>
  </div>
);
}

export function EditorAparencia({
  galeriaId,
  caminhoPublico,
  inicial,
}: {
  galeriaId: string;
  caminhoPublico: string;
  inicial: Aparencia;
}) {
  const [ap, setAp] = useState<Aparencia>(inicial);
  const [salvo, setSalvo] = useState(true);
  const [versaoPreview, setVersaoPreview] = useState(0);
  const [salvando, iniciar] = useTransition();
  const router = useRouter();

  const presetAtivo = presetEquivalente(ap);

  function mudar(novo: Aparencia) {
    setAp(novo);
    setSalvo(false);
  }

  function salvar() {
    iniciar(async () => {
      const f = new FormData();
      f.set("galeria_id", galeriaId);
      f.set("aparencia", JSON.stringify(ap));
      await salvarAparenciaAction(f);
      setSalvo(true);
      setVersaoPreview((v) => v + 1); // recarrega o iframe com o que foi salvo
      router.refresh();
    });
  }

  return (
    <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Aparência da galeria</h2>
          <p className="mt-0.5 text-xs text-texto-faint">
            Escolha um estilo pronto ou ajuste cada detalhe. A prévia é a galeria de verdade.
          </p>
        </div>
        <button
          type="button"
          onClick={salvar}
          disabled={salvo || salvando}
          className="rounded-lg bg-acento px-4 py-2 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:opacity-40"
        >
          {salvando ? "Salvando…" : salvo ? "Salvo ✓" : "Salvar aparência"}
        </button>
      </div>

      {/* Presets */}
      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {PRESETS.map((p) => {
          const ativo = presetAtivo === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => mudar(p.aparencia)}
              className={`rounded-lg border p-3 text-left transition ${
                ativo
                  ? "border-acento bg-acento/5"
                  : "border-linha hover:border-linha-forte hover:bg-carbon-2"
              }`}
            >
              <span className="flex items-center gap-2">
                <MiniaturaPreset id={p.id} />
                <span className="text-sm font-medium">{p.nome}</span>
              </span>
              <span className="mt-1.5 block text-[11px] leading-snug text-texto-faint">
                {p.desc}
              </span>
            </button>
          );
        })}
      </div>

      {/* Ajuste fino */}
      <details className="mt-5 border-t border-linha pt-4">
        <summary className="cursor-pointer text-xs text-texto-soft">
          Ajustar em detalhe {presetAtivo ? "" : "· personalizado"}
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Eixo eixo="capa" titulo="Capa" ap={ap} mudar={mudar} />
          <Eixo eixo="tema" titulo="Cores" ap={ap} mudar={mudar} />
          <SeletorDeFonte ap={ap} mudar={mudar} />
          <Eixo eixo="grade" titulo="Grade das fotos" ap={ap} mudar={mudar} />
          <Eixo eixo="densidade" titulo="Espaçamento" ap={ap} mudar={mudar} />
        </div>
      </details>

      {/* Prévia */}
      <div className="mt-5 border-t border-linha pt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium text-texto-soft">Prévia</span>
          {!salvo && (
            <span className="text-[11px] text-alerta">
              salve para ver as mudanças aqui
            </span>
          )}
        </div>
        <div className="mt-2 overflow-hidden rounded-lg border border-linha bg-void">
          <iframe
            key={versaoPreview}
            src={caminhoPublico}
            title="Prévia da galeria"
            className="h-[460px] w-full"
            loading="lazy"
          />
        </div>
      </div>
    </section>
  );
}

/** Rabisco do layout de cada preset — ajuda a escolher sem precisar abrir. */
function MiniaturaPreset({ id }: { id: string }) {
  const comum = "h-6 w-8 shrink-0 rounded-[3px] border border-linha p-[3px]";
  if (id === "atomo") {
    return (
      <span className={`${comum} bg-void`}>
        <span className="grid h-full grid-cols-3 gap-[1px]">
          <span className="col-span-2 row-span-2 bg-acento/70" />
          <span className="bg-texto-faint/50" />
          <span className="bg-texto-faint/50" />
        </span>
      </span>
    );
  }
  if (id === "revista") {
    return (
      <span className={`${comum} bg-white`}>
        <span className="flex h-full gap-[1px]">
          <span className="flex-1 bg-neutral-400" />
          <span className="flex-1 bg-neutral-300" />
          <span className="flex-1 bg-neutral-400" />
        </span>
      </span>
    );
  }
  if (id === "atelie") {
    return (
      <span className={`${comum}`} style={{ background: "#f2ebdd" }}>
        <span className="flex h-full flex-col gap-[1px]">
          <span className="flex-1" style={{ background: "#927659" }} />
          <span className="flex-1" style={{ background: "#c0ab8e" }} />
        </span>
      </span>
    );
  }
  return (
    <span className={`${comum} bg-white`}>
      <span className="grid h-full grid-cols-3 grid-rows-2 gap-[1px]">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="bg-neutral-400" />
        ))}
      </span>
    </span>
  );
}
