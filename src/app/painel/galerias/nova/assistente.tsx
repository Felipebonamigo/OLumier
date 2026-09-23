"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { criarGaleriaAction, type EstadoGaleria } from "../../actions";
import {
  Campo,
  Erro,
  BotaoEnviar,
  BOTAO_PRIMARIO,
  BOTAO_SECUNDARIO,
} from "@/components/form-ui";
import { FONTES_TITULO, PRESETS, TEMAS } from "@/config/aparencia";

/**
 * Criar galeria em três etapas.
 *
 * ── POR QUE ETAPAS, SE ANTES ERAM TRÊS CAMPOS ─────────────────────────────
 *
 * Não foi para fatiar os três campos: quebrar "nome, local, data" em três telas
 * seria atrito puro. As etapas existem porque DUAS decisões que o fotógrafo já
 * tomava — depois, escondidas em outra tela — passam a caber aqui:
 *
 *   ESTILO     ele escolhia a aparência depois, e muitos nunca descobriam que
 *              dava. Perguntar na criação transforma "achar o editor" em "clicar
 *              num cartão", e a galeria já nasce com cara de entrega.
 *   CAPÍTULOS  a ordem do trabalho é montar os capítulos ANTES de enviar (foi por
 *              isso que eles subiram para o topo da aba Fotos em 04/09/2026).
 *              Criá-los aqui é o único jeito de eles existirem antes do envio
 *              sem uma volta a mais.
 *
 * Nenhuma das duas é obrigatória: dá para passar direto e decidir depois. Etapa
 * que não se pode pular vira formulário longo com botão de "próximo".
 */

const ETAPAS = ["Dados", "Estilo", "Capítulos"] as const;

function Botao({ ultima }: { ultima: boolean }) {
  const { pending } = useFormStatus();
  /*
   * Na última etapa "Criar galeria" É o caminho, e leva a ênfase. Antes dela,
   * "Continuar" é o caminho e este botão é o atalho de quem não quer as duas
   * etapas opcionais — secundário, e da mesma altura. Ver `BOTAO_BASE`.
   */
  return (
    <BotaoEnviar carregando={pending} emLinha variante={ultima ? "primario" : "secundario"}>
      {ultima ? "Criar galeria" : "Criar mesmo assim"}
    </BotaoEnviar>
  );
}

export function AssistenteNovaGaleria({
  capitulosSugeridos,
  slotLogo,
}: {
  /** Vem do servidor: `lib/secoes.ts` é server-only e não pode ser importado aqui. */
  capitulosSugeridos: readonly string[];
  /** A logo do estúdio, montada no servidor — aparece junto do estilo. */
  slotLogo?: ReactNode;
}) {
  const [estado, action] = useActionState<EstadoGaleria, FormData>(criarGaleriaAction, {});
  const [etapa, setEtapa] = useState(0);
  const [titulo, setTitulo] = useState("");
  const [preset, setPreset] = useState<string>("");
  const [capitulos, setCapitulos] = useState<string[]>([]);

  const semNome = titulo.trim().length === 0;

  return (
    <form action={action} className="mt-8">
      {/*
        Os campos das etapas anteriores continuam no formulário, escondidos —
        um `<form>` só manda o que está montado, e desmontar a etapa 1 ao passar
        para a 2 apagaria o nome que a pessoa acabou de digitar.
      */}
      <ol className="flex items-center gap-2 text-xs">
        {ETAPAS.map((nome, i) => (
          <li key={nome} className="flex items-center gap-2">
            <button
              type="button"
              /* Voltar é livre; avançar exige o nome. Passo que trava sem dizer
                 por quê é a pior parte de todo assistente. */
              disabled={i > etapa && semNome}
              onClick={() => setEtapa(i)}
              className={`rounded-full px-3 py-1 transition disabled:opacity-40 ${
                i === etapa
                  ? "bg-acento font-semibold text-void"
                  : i < etapa
                    ? "border border-linha text-texto-soft hover:bg-carbon"
                    : "border border-linha text-texto-faint"
              }`}
            >
              {i + 1}. {nome}
            </button>
            {i < ETAPAS.length - 1 && <span className="text-texto-faint">·</span>}
          </li>
        ))}
      </ol>

      <div className={etapa === 0 ? "mt-6 flex flex-col gap-4" : "hidden"}>
        <Campo
          label="Nome da galeria"
          name="titulo"
          required
          placeholder="Ana & Pedro"
          dica="É o que o cliente vê como título da entrega."
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
        />
        <Campo label="Local ou descrição" name="subtitulo" placeholder="Serra Gaúcha" />
        <Campo label="Data do evento" name="data_evento" type="date" />
      </div>

      <div className={etapa === 1 ? "mt-6" : "hidden"}>
        <p className="text-sm text-texto-soft">
          Como a galeria vai aparecer para o cliente. Dá para trocar tudo depois, em Design.
        </p>
        <input type="hidden" name="preset" value={preset} />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PRESETS.map((p) => {
            const tema = TEMAS[p.aparencia.tema];
            const escolhido = preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(escolhido ? "" : p.id)}
                aria-pressed={escolhido}
                className={`rounded-xl border p-3 text-left transition ${
                  escolhido ? "border-acento bg-carbon-2" : "border-linha hover:bg-carbon"
                }`}
              >
                {/* Amostra honesta: o fundo e a letra que o preset realmente usa. */}
                <span
                  className="mb-2 flex h-14 items-center justify-center rounded-lg text-lg"
                  style={{
                    background: tema["--g-fundo"],
                    color: tema["--g-texto"],
                    border: `1px solid ${tema["--g-linha"]}`,
                    fontFamily: FONTES_TITULO[p.aparencia.tipografia],
                  }}
                >
                  Ana &amp; Pedro
                </span>
                <span className="block text-sm font-medium">{p.nome}</span>
                <span className="mt-0.5 block text-xs text-texto-faint">{p.desc}</span>
              </button>
            );
          })}
        </div>
        {slotLogo && <div className="mt-6">{slotLogo}</div>}
      </div>

      <div className={etapa === 2 ? "mt-6" : "hidden"}>
        <p className="text-sm text-texto-soft">
          Os momentos do evento. O cliente ganha um menu para pular direto ao que quer ver — e
          você manda as fotos já para o capítulo certo.
        </p>
        <input type="hidden" name="capitulos" value={capitulos.join("\n")} />
        <div className="mt-4 flex flex-wrap gap-2">
          {capitulosSugeridos.map((nome) => {
            const marcado = capitulos.includes(nome);
            return (
              <button
                key={nome}
                type="button"
                aria-pressed={marcado}
                onClick={() =>
                  setCapitulos((atual) =>
                    marcado ? atual.filter((c) => c !== nome) : [...atual, nome],
                  )
                }
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  marcado
                    ? "border-acento bg-acento/10 text-acento-alto"
                    : "border-linha text-texto-soft hover:bg-carbon"
                }`}
              >
                {marcado ? "✓ " : ""}
                {nome}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-texto-faint">
          {capitulos.length === 0
            ? "Nenhum escolhido — a galeria fica numa sequência só, o que também funciona."
            : `${capitulos.length} ${capitulos.length === 1 ? "capítulo" : "capítulos"}, na ordem em que você marcou.`}
        </p>
      </div>

      <Erro mensagem={estado.erro} />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {etapa > 0 && (
          <button
            type="button"
            onClick={() => setEtapa((e) => e - 1)}
            className={BOTAO_SECUNDARIO}
          >
            Voltar
          </button>
        )}
        {etapa < ETAPAS.length - 1 && (
          <button
            type="button"
            disabled={semNome}
            onClick={() => setEtapa((e) => e + 1)}
            className={BOTAO_PRIMARIO}
          >
            Continuar
          </button>
        )}
        {/*
          O botão de criar existe em TODA etapa, e não só na última.

          Quem só quer a galeria não deve precisar atravessar escolha de estilo e
          de capítulo para chegar nela — as duas são opcionais e existem para
          poupar trabalho, não para cobrar. Na última etapa ele muda de rótulo
          porque ali "criar" é o fim natural, não um atalho.
        */}
        {!semNome && <Botao ultima={etapa === ETAPAS.length - 1} />}
      </div>
    </form>
  );
}
