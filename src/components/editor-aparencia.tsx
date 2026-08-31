"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
  const [versaoPreview, setVersaoPreview] = useState(0);
  const [salvando, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();
  const agendado = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* A escolha que ainda não foi gravada. Existe para a saída da tela poder
   * disparar a última — o `ap` do estado não serve, porque o fechamento do
   * efeito de desmontagem congela o valor da primeira renderização. */
  const pendente = useRef<Aparencia | null>(null);

  const presetAtivo = presetEquivalente(ap);

  /*
   * Cada clique grava. Não há mais botão "Salvar".
   *
   * Escolher aparência é decisão que se toma OLHANDO — clica, vê, clica de novo.
   * Um botão no meio disso pede que a pessoa confirme uma escolha que ela ainda
   * está tomando, e o preço de esquecer de apertar era a prévia mentindo e o
   * trabalho perdido ao sair da tela.
   *
   * A espera de meio segundo não é enfeite: sem ela, passar por quatro presets
   * dispara quatro gravações e quatro recarregamentos do iframe, e a prévia
   * pisca mais do que informa. Cada clique novo cancela o anterior, então vale
   * sempre a ÚLTIMA escolha — que é a que a pessoa quis.
   */
  function mudar(novo: Aparencia) {
    setAp(novo);
    setErro(null);
    pendente.current = novo;
    if (agendado.current) clearTimeout(agendado.current);
    agendado.current = setTimeout(() => gravar(novo), 500);
  }

  function corpo(valor: Aparencia) {
    const f = new FormData();
    f.set("galeria_id", galeriaId);
    f.set("aparencia", JSON.stringify(valor));
    return f;
  }

  function gravar(valor: Aparencia) {
    pendente.current = null;
    iniciar(async () => {
      const r = await salvarAparenciaAction(corpo(valor));
      if (r?.erro) {
        setErro(r.erro);
        return;
      }
      setVersaoPreview((v) => v + 1); // recarrega o iframe com o que foi salvo
      router.refresh();
    });
  }

  /*
   * Sair da tela com gravação agendada DISPARA, não cancela.
   *
   * Cancelar é o reflexo — evita atualizar estado de componente desmontado. Aqui
   * ele custaria exatamente a última escolha, a que a pessoa acabou de fazer
   * antes de mudar de página. Por isso a chamada sai crua, fora da transição: o
   * pedido já saiu do navegador quando o componente some, e ninguém precisa
   * estar vivo para receber a resposta.
   */
  useEffect(
    () => () => {
      if (agendado.current) clearTimeout(agendado.current);
      if (pendente.current) void salvarAparenciaAction(corpo(pendente.current));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roda só na saída
    [],
  );

  return (
    <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Aparência da galeria</h2>
          <p className="mt-0.5 text-xs text-texto-faint">
            Escolha um estilo pronto ou ajuste cada detalhe. A prévia é a galeria de verdade.
          </p>
        </div>
        {/* No lugar do botão, o estado. Não há o que apertar: a escolha já foi
            gravada, e a única coisa que a pessoa ainda precisa saber é se deu
            certo. Erro fica em vermelho e não some sozinho. */}
        <span
          role="status"
          aria-live="polite"
          className={`text-xs ${erro ? "text-alerta" : "text-texto-faint"}`}
        >
          {erro ?? (salvando ? "salvando…" : "salvo automaticamente")}
        </span>
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
                <MiniaturaPreset aparencia={p.aparencia} />
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
          <Eixo eixo="logo" titulo="Tamanho da logo" ap={ap} mudar={mudar} />
        </div>
      </details>

      {/* Prévia */}
      <div className="mt-5 border-t border-linha pt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium text-texto-soft">Prévia</span>
          {salvando && <span className="text-[11px] text-texto-faint">atualizando…</span>}
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

        {/*
          A PRÉVIA CABE NUMA CAIXA; A GALERIA NÃO.

          O iframe tem 460px de altura e a largura do painel — e a galeria é
          desenhada para tela cheia. Capa imersa, grade editorial e espaçamento
          arejado são exatamente as escolhas que a caixa achata, então a prévia
          mostra bem o CLIMA e mal a proporção. Quem vai decidir "está bom para
          o meu cliente" precisa ver do jeito que o cliente vê.

          Abre em aba nova de propósito: a decisão continua sendo tomada aqui, e
          perder o editor para conferir seria trocar uma pergunta por outra.
        */}
        <a
          href={caminhoPublico}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-linha-forte px-4 py-2 text-sm transition hover:bg-carbon-2"
        >
          Visualizar galeria ↗
        </a>
        <p className="mt-1.5 text-xs text-texto-faint">
          Abre em tela cheia, do jeito que o seu cliente vê.
        </p>
      </div>
    </section>
  );
}

/**
 * Rabisco do preset — ajuda a escolher sem precisar abrir.
 *
 * Deduzido da APARÊNCIA, não escrito por id. Antes havia um desenho codificado
 * para cada um dos quatro presets e um genérico para o resto; ao acrescentar
 * quatro em 27/08/2026, os quatro novos cairiam todos no mesmo rabisco — o
 * oposto do trabalho dele, que é diferenciar.
 *
 * O tema dá o papel, a grade dá o arranjo. Preset novo ganha o seu de graça, e
 * ninguém precisa lembrar de vir aqui.
 */
function MiniaturaPreset({ aparencia }: { aparencia: Aparencia }) {
  const comum = "h-6 w-8 shrink-0 rounded-[3px] border border-linha p-[3px]";

  /* O papel de cada tema, e a tinta que aparece por cima dele. Valores crus e
   * não tokens: isto é um rabisco de OUTRO tema dentro do painel, e usar as
   * cores do painel faria os três rabiscos ficarem iguais. */
  const papel =
    aparencia.tema === "noite"
      ? { fundo: "#07080b", cheio: "#d9a441", vazio: "rgba(190,205,230,0.32)" }
      : aparencia.tema === "creme"
        ? { fundo: "#f2ebdd", cheio: "#927659", vazio: "#c0ab8e" }
        : { fundo: "#ffffff", cheio: "#9ca3af", vazio: "#d1d5db" };

  const bloco = (cor: string, extra = "") => (
    <span className={extra} style={{ background: cor }} />
  );

  return (
    <span className={comum} style={{ background: papel.fundo }}>
      {aparencia.grade === "editorial" ? (
        <span className="grid h-full grid-cols-3 grid-rows-2 gap-[1px]">
          {bloco(papel.cheio, "col-span-2 row-span-2")}
          {bloco(papel.vazio)}
          {bloco(papel.vazio)}
        </span>
      ) : aparencia.grade === "linhas" ? (
        <span className="flex h-full flex-col gap-[1px]">
          {bloco(papel.cheio, "flex-1")}
          {bloco(papel.vazio, "flex-1")}
        </span>
      ) : aparencia.grade === "colunas" ? (
        <span className="flex h-full items-end gap-[1px]">
          {bloco(papel.cheio, "h-full flex-1")}
          {bloco(papel.vazio, "h-2/3 flex-1")}
          {bloco(papel.cheio, "h-5/6 flex-1")}
        </span>
      ) : (
        <span className="grid h-full grid-cols-3 grid-rows-2 gap-[1px]">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} style={{ background: i % 2 ? papel.vazio : papel.cheio }} />
          ))}
        </span>
      )}
    </span>
  );
}
