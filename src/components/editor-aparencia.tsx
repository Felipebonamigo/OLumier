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
function SeletorDeFonte({ ap, mudar, temFontePropria }: PecaProps & { temFontePropria: boolean }) {
  /* A fonte do estúdio só existe para quem enviou uma. Some da lista em vez de
     aparecer desabilitada: opção morta na tela é pergunta que a pessoa faz e
     ninguém responde — e o lugar de enviar é Conta, não aqui. */
  const disponiveis = OPCOES.tipografia.filter((o) => o.id !== "propria" || temFontePropria);
  const familias = [...new Set(disponiveis.map((o) => o.familia))];
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
              {disponiveis
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
  temFontePropria,
}: {
  galeriaId: string;
  caminhoPublico: string;
  inicial: Aparencia;
  /** O estúdio enviou uma fonte? Decide se a opção aparece no seletor. */
  temFontePropria: boolean;
}) {
  const [ap, setAp] = useState<Aparencia>(inicial);
  /* O que está GRAVADO. Separado do que está na tela: é a diferença entre os
     dois que acende o botão e diz o que ainda não foi publicado. */
  const [salvo, setSalvo] = useState<Aparencia>(inicial);
  const [salvando, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();
  const agendado = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * ── DE SALVAMENTO AUTOMÁTICO PARA UM ATO (31/08/2026) ────────────────────
   *
   * Cada clique gravava. O motivo era a prévia: o iframe desenha a galeria a
   * partir do BANCO, então mostrar a escolha exigia gravá-la antes — e o efeito
   * colateral era que experimentar já mudava a galeria do cliente. Quem estava
   * no meio de "clica, vê, clica de novo" publicava, sem querer, cada passo do
   * caminho; se desistisse, o último passo era o que ficava.
   *
   * O dono pediu um botão, e o botão só pôde existir porque a prévia parou de
   * depender do banco: a aparência pendente viaja na URL do iframe (`?ap=`), e
   * a galeria pública a desenha sem gravar nada (ver a página em `/g`).
   *
   * A espera de 400 ms continua, mas mudou de função: antes segurava GRAVAÇÕES,
   * agora segura RECARGAS do iframe. Sem ela, passar por quatro presets faz a
   * prévia piscar quatro vezes e informar menos do que atrapalha.
   */
  const [apPrevia, setApPrevia] = useState<Aparencia>(inicial);

  const presetAtivo = presetEquivalente(ap);
  const sujo = JSON.stringify(ap) !== JSON.stringify(salvo);

  function mudar(novo: Aparencia) {
    setAp(novo);
    setErro(null);
    if (agendado.current) clearTimeout(agendado.current);
    agendado.current = setTimeout(() => setApPrevia(novo), 400);
  }

  function corpo(valor: Aparencia) {
    const f = new FormData();
    f.set("galeria_id", galeriaId);
    f.set("aparencia", JSON.stringify(valor));
    return f;
  }

  function publicar() {
    iniciar(async () => {
      const r = await salvarAparenciaAction(corpo(ap));
      if (r?.erro) {
        setErro(r.erro);
        return;
      }
      setSalvo(ap);
      router.refresh();
    });
  }

  /*
   * Fechar a aba com mudança não publicada AVISA.
   *
   * Não substitui o botão, e nem tenta: é a rede para o gesto que ninguém
   * planeja. Navegação dentro do painel não dispara este evento — ali quem
   * segura é a barra fixa, que fica na tela enquanto houver o que publicar.
   */
  useEffect(() => {
    if (!sujo) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sujo]);

  useEffect(() => () => void (agendado.current && clearTimeout(agendado.current)), []);

  return (
    <section className="mt-8 rounded-xl border border-linha bg-carbon p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Aparência da galeria</h2>
          <p className="mt-0.5 text-xs text-texto-faint">
            Escolha um estilo pronto ou ajuste cada detalhe. A prévia é a galeria de verdade.
          </p>
        </div>
        {/*
          O ESTILO EM USO, DITO POR EXTENSO.
          Reabrindo a tela, a pessoa via oito botões e precisava caçar qual
          estava marcado — e quando ela tinha mexido num detalhe, nenhum estava,
          o que parecia esquecimento do sistema. Agora a resposta está escrita:
          o nome do preset, ou "personalizado" quando a combinação é dela.
        */}
        <span
          role="status"
          aria-live="polite"
          className={`text-xs ${erro ? "text-alerta" : "text-texto-faint"}`}
        >
          {erro ??
            (sujo
              ? "alterações não publicadas"
              : `no ar: ${PRESETS.find((p) => p.id === presetAtivo)?.nome ?? "personalizado"}`)}
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
      <details open={!presetAtivo} className="mt-5 border-t border-linha pt-4">
        <summary className="cursor-pointer text-xs text-texto-soft">
          Ajustar em detalhe {presetAtivo ? "" : "· personalizado"}
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Eixo eixo="capa" titulo="Capa" ap={ap} mudar={mudar} />
          <Eixo eixo="tema" titulo="Cores" ap={ap} mudar={mudar} />
          <SeletorDeFonte ap={ap} mudar={mudar} temFontePropria={temFontePropria} />
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
        {/*
          `&amostra=1` SÓ NO IFRAME, nunca no link de baixo.

          A caixa recarrega a cada mudança de eixo, e carregar a galeria inteira
          para desenhar seis miniaturas era o que fazia a espera que a Carol
          reclamou. A amostra manda poucas fotos e não assina os tamanhos que a
          caixa não usa.

          O botão "Visualizar galeria" continua sem o parâmetro de propósito:
          ele promete a galeria como o cliente vê, e uma amostra ali seria uma
          mentira difícil de descobrir. `scripts/testar-previa.mjs` prende os
          dois lados.
        */}
        <div className="mt-2 overflow-hidden rounded-lg border border-linha bg-void">
          <iframe
            key={JSON.stringify(apPrevia)}
            src={`${caminhoPublico}&amostra=1&ap=${encodeURIComponent(JSON.stringify(apPrevia))}`}
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

      {/*
        A BARRA QUE NÃO SAI DA TELA.

        `fixed`, e não `sticky`: a seção de aparência é longa, e a decisão de
        publicar pode ser tomada olhando a prévia lá no fim dela. Grudada na
        seção, a barra sumiria justamente quando a pessoa rolasse para conferir
        o resultado — que é o gesto que antecede o clique.

        Só existe quando há o que publicar. Barra permanente vira moldura: em
        duas semanas ninguém mais a enxerga, e ela deixa de avisar no dia em que
        precisar avisar.
      */}
      {sujo && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-linha-forte bg-carbon/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
            <span className="text-xs text-texto-soft">
              A prévia já mostra o novo estilo.{" "}
              <strong className="font-medium text-texto">
                O seu cliente ainda vê o anterior.
              </strong>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={salvando}
                onClick={() => {
                  setAp(salvo);
                  setApPrevia(salvo);
                  setErro(null);
                }}
                className="rounded-lg px-3 py-2 text-xs text-texto-faint underline underline-offset-4 transition hover:text-texto disabled:opacity-40"
              >
                descartar
              </button>
              <button
                type="button"
                disabled={salvando}
                onClick={publicar}
                className="rounded-lg bg-acento px-5 py-2.5 text-sm font-semibold text-void transition hover:bg-acento-alto disabled:opacity-40"
              >
                {salvando ? "Publicando…" : "Publicar aparência"}
              </button>
            </div>
          </div>
        </div>
      )}
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
