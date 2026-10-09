"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { criarGaleriaAction, type EstadoGaleria } from "../../actions";
import {
  Campo,
  Erro,
  BotaoEnviar,
  BOTAO_PRIMARIO,
  BOTAO_SECUNDARIO,
} from "@/components/form-ui";
import {
  OPCOES,
  PRESETS,
  APARENCIA_PADRAO,
  mesmaAparencia,
  type Aparencia,
  type Formato,
} from "@/config/aparencia";
import type { EstiloDoEstudio } from "@/lib/estilos-do-estudio";
import { AmostraDoPreset } from "@/components/amostra-do-preset";
import { EsquemaDoFormato } from "@/components/esquema-do-formato";
import { CapaEmVideoNaCriacao } from "@/components/capa-em-video-na-criacao";
import { ErroDoClipe, enviarClipeDaCapa, type ClipePronto } from "@/lib/clipe-da-capa";

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

function Botao({ ultima, bloqueado }: { ultima: boolean; bloqueado: boolean }) {
  const { pending } = useFormStatus();
  /*
   * Na última etapa "Criar galeria" É o caminho, e leva a ênfase. Antes dela,
   * "Continuar" é o caminho e este botão é o atalho de quem não quer as duas
   * etapas opcionais — secundário, e da mesma altura. Ver `BOTAO_BASE`.
   */
  return (
    <BotaoEnviar carregando={pending || bloqueado} emLinha variante={ultima ? "primario" : "secundario"}>
      {ultima ? "Criar galeria" : "Criar mesmo assim"}
    </BotaoEnviar>
  );
}

export function AssistenteNovaGaleria({
  capitulosSugeridos,
  padraoDoEstudio = null,
  estilosDoEstudio = [],
  slotLogo,
  formatosLiberados = false,
}: {
  /** A conta vê Pastas e Stream? Ver `config/formatos-liberados.ts`. */
  formatosLiberados?: boolean;
  /** Vem do servidor: `lib/secoes.ts` é server-only e não pode ser importado aqui. */
  capitulosSugeridos: readonly string[];
  /** O design que o estúdio salvou como padrão, ou null se nunca salvou. */
  padraoDoEstudio?: Aparencia | null;
  /** Os até cinco estilos salvos do estúdio, com nome (28/09/2026). */
  estilosDoEstudio?: EstiloDoEstudio[];
  /** A logo do estúdio, montada no servidor — aparece junto do estilo. */
  slotLogo?: ReactNode;
}) {
  const [estado, action] = useActionState<EstadoGaleria, FormData>(criarGaleriaAction, {});
  const [etapa, setEtapa] = useState(0);
  const [titulo, setTitulo] = useState("");
  const [preset, setPreset] = useState<string>("");
  /* Um estilo salvo do estúdio, pelo id. Escolher um apaga o preset e
     vice-versa: a galeria nasce com UMA decisão — ver
     `aparenciaInicialDaGaleria`. */
  const [estilo, setEstilo] = useState<string>("");
  const [capitulos, setCapitulos] = useState<string[]>([]);
  /* O formato abre no do padrão do estúdio: é o que a galeria receberia se
     ninguém mexesse, e a tela não pode dizer uma coisa e criar outra. */
  const [formato, setFormato] = useState<Formato>(
    padraoDoEstudio?.formato ?? APARENCIA_PADRAO.formato,
  );

  /*
   * A CAPA EM VÍDEO, escolhida na etapa de estilo (08/10/2026). O clipe é
   * preparado aqui, no navegador; depois que a ação cria a galeria e devolve o
   * id, ele sobe — e só então a pessoa é levada a ela. Se o envio falhar a
   * galeria JÁ existe: a tela diz isso e oferece abri-la, em vez de fingir que
   * nada nasceu.
   */
  const router = useRouter();
  /* A capa em tela cheia (Felipe: "uma opção 'capa em tela cheia' e aí outra para
     escolher vídeo ou foto"). A tela cheia é a decisão; foto ou vídeo, o que a
     ocupa. Foto vale para qualquer conta; vídeo, para quem tem os formatos. */
  const [telaCheia, setTelaCheia] = useState(false);
  const [tipoDaCapa, setTipoDaCapa] = useState<"foto" | "video">("foto");
  const [clipe, setClipe] = useState<ClipePronto | null>(null);
  const [preparandoClipe, setPreparandoClipe] = useState(false);
  const [falhaDoClipe, setFalhaDoClipe] = useState<string | null>(null);
  const galeriaCriada = estado.galeriaId ?? null;

  useEffect(() => {
    if (!galeriaCriada) return;
    let cancelado = false;
    void (async () => {
      try {
        if (clipe) await enviarClipeDaCapa(galeriaCriada, clipe);
      } catch (e) {
        if (!cancelado) {
          setFalhaDoClipe(e instanceof ErroDoClipe ? e.message : "O envio do clipe não deu certo.");
        }
        return;
      }
      if (!cancelado) router.push(`/painel/galerias/${galeriaCriada}`);
    })();
    return () => {
      cancelado = true;
    };
    // O clipe é o desta criação e não muda depois do envio; refazer o envio a
    // cada troca dele mandaria o mesmo arquivo duas vezes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galeriaCriada]);

  const opcoesDaCapa: { id: "foto" | "video"; nome: string; desc: string }[] = [
    { id: "foto", nome: "Foto", desc: "A foto de capa da galeria — você a escolhe depois, em Design → Capa." },
    ...(formatosLiberados
      ? [{ id: "video" as const, nome: "Vídeo", desc: "Um clipe de até 30 segundos, mudo e em laço." }]
      : []),
  ];
  /* O vídeo é a escolha ATIVA: só vale com a tela cheia ligada e "Vídeo" marcado. */
  const comVideo = telaCheia && tipoDaCapa === "video";
  /* Entre o "criar" e a galeria abrir — o clipe subindo — nada mais se aperta. */
  const subindoClipe = Boolean(galeriaCriada) && !falhaDoClipe;
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

      {/* O formulário continua estreito de propósito: campo de texto largo
          demais faz o olho perder o começo da linha. Ver o comentário da
          largura em `page.tsx`. */}
      <div className={etapa === 0 ? "mt-6 flex max-w-2xl flex-col gap-4" : "hidden"}>
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
        {/*
          ── O PADRÃO DO ESTÚDIO APARECE AQUI (26/09/2026) ─────────────────

          "Os estilos salvos não estão fácil de achar, não conseguimos
          descobrir onde estão." Ele já valia nesta tela — `criarGaleriaAction`
          usa o padrão quando nenhum cartão é marcado —, mas de um jeito
          invisível: a etapa mostrava só os nossos dez, nenhum marcado, e quem
          tinha salvo o próprio design achava que ele tinha sumido. Pior:
          apontar um cartão para "procurar" o seu trocava o padrão por outro.

          Agora ele é o primeiro cartão e já vem marcado, porque é o que
          acontece se ninguém mexer. Marcá-lo manda `preset` vazio — o mesmo
          caminho de antes, e a mesma ordem que `testar-padrao-do-estudio`
          prende no servidor. Sem padrão salvo, a frase diz onde ele nasce.
        */}
        <p className="text-sm text-texto-soft">
          {padraoDoEstudio
            ? "Como a galeria vai aparecer para o cliente. Ela já nasce no seu padrão — escolha outro estilo só se esta entrega pedir. Dá para trocar tudo depois, em Design."
            : "Como a galeria vai aparecer para o cliente. Dá para trocar tudo depois, em Design."}
        </p>
        {!padraoDoEstudio && (
          <p className="mt-1 text-xs text-texto-faint">
            Tem um design seu? Monte-o na aba Design de qualquer galeria e aperte “Salvar como meu
            padrão” — ele passa a aparecer aqui como a primeira opção.
          </p>
        )}
        {/*
          ── O FORMATO VEM ANTES DO ESTILO (30/09/2026) ─────────────────────

          Felipe, nesta tela: "deveria aqui ter a opção para selecionar os 3
          tipos, se é galeria, pastas ou stream". O formato é a decisão maior
          — a estrutura da entrega — e o fotógrafo já a traz pronta: o filme
          do casamento é Stream antes de existir. Vem em cima porque é lida
          primeiro, e os estilos abaixo valem para os três.

          Mesmos cartões do grupo Formato do Design (`EsquemaDoFormato`), e o
          estilo continua não mexendo no formato: são duas escolhas.
        */}
        {formatosLiberados && <input type="hidden" name="formato" value={formato} />}
        <fieldset className={formatosLiberados ? "mt-5" : "hidden"}>
          <legend className="text-xs font-medium text-texto-soft">Formato da entrega</legend>
          <div className="mt-2 grid max-w-3xl gap-3 sm:grid-cols-3">
            {OPCOES.formato.map((op) => {
              const escolhido = formato === op.id;
              return (
                <button
                  key={op.id}
                  type="button"
                  aria-pressed={escolhido}
                  onClick={() => setFormato(op.id)}
                  className={`rounded-xl border p-3 text-left transition ${
                    escolhido ? "border-acento bg-carbon-2" : "border-linha hover:bg-carbon"
                  }`}
                >
                  <span className="mb-2 block h-20 overflow-hidden rounded-md border border-linha bg-carbon-2">
                    <EsquemaDoFormato formato={op.id} />
                  </span>
                  <span className="block text-sm font-medium">{op.nome}</span>
                  <span className="mt-0.5 block text-xs text-texto-faint">{op.desc}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        {/*
          ── A CAPA EM TELA CHEIA (08/10/2026) ──────────────────────────────

          Felipe, com o reel de uma capa em vídeo: "é um vídeo na tela toda, e
          conforme desce, tem uma galeria — coloque essa opção na hora de montar
          a galeria". E, vendo a primeira versão, que só existia com vídeo: "uma
          opção 'capa em tela cheia' e aí outra para escolher vídeo ou foto".

          A TELA CHEIA é a decisão (a capa é a tela inteira, e a galeria começa ao
          rolar); FOTO ou VÍDEO é o que a ocupa. Fica logo depois do formato (a
          estrutura) e antes dos estilos (a cara): ela decide a capa e a altura, e
          o resto do estilo continua a escolha de quem monta.
        */}
        <input type="hidden" name="capa_tela_cheia" value={telaCheia ? "1" : ""} />
        <input type="hidden" name="com_clipe" value={comVideo && clipe ? "1" : ""} />
        <fieldset className="mt-5 max-w-3xl">
          <legend className="text-xs font-medium text-texto-soft">Capa</legend>
          <button
            type="button"
            aria-pressed={telaCheia}
            onClick={() => setTelaCheia((v) => !v)}
            className={`mt-2 block w-full rounded-xl border p-3 text-left transition ${
              telaCheia ? "border-acento bg-carbon-2" : "border-linha hover:bg-carbon"
            }`}
          >
            <span className="block text-sm font-medium">
              {telaCheia ? "✓ " : ""}Capa em tela cheia
            </span>
            <span className="mt-0.5 block text-xs text-texto-faint">
              A capa ocupa a tela inteira e a galeria começa ao rolar. Nasce com a capa Imersa; o resto
              do estilo continua o que você escolher. Dá para mudar depois, em Design → Capa.
            </span>
          </button>
          {telaCheia && (
            <div className="mt-3 pl-1">
              <p className="text-xs font-medium text-texto-soft">O que ocupa a tela</p>
              <div className="mt-2 grid max-w-xl gap-3 sm:grid-cols-2">
                {opcoesDaCapa.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={tipoDaCapa === o.id}
                    onClick={() => setTipoDaCapa(o.id)}
                    className={`rounded-xl border p-3 text-left transition ${
                      tipoDaCapa === o.id ? "border-acento bg-carbon-2" : "border-linha hover:bg-carbon"
                    }`}
                  >
                    <span className="block text-sm font-medium">{o.nome}</span>
                    <span className="mt-0.5 block text-xs text-texto-faint">{o.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Montado sempre e só escondido: o clipe preparado (e o preparo em
              andamento) não pode sumir se a pessoa alternar Foto e Vídeo. */}
          {formatosLiberados && (
            <div className={comVideo ? "pl-1" : "hidden"}>
              <CapaEmVideoNaCriacao
                aoMudar={(pronto, preparando) => {
                  setClipe(pronto);
                  setPreparandoClipe(preparando);
                }}
              />
            </div>
          )}
        </fieldset>
        {formatosLiberados && <p className="mt-6 text-xs font-medium text-texto-soft">Estilo</p>}
        <input type="hidden" name="preset" value={preset} />
        <input type="hidden" name="estilo" value={estilo} />
        {/* Mais colunas conforme a tela, porque aqui a largura VIRA amostra:
            com três colunas dentro de 672 px cada "Ana & Pedro" saía com ~155
            px, e escolher a cara da entrega por uma miniatura desse tamanho é
            escolher no escuro. O teto é cinco — passando disso a amostra volta
            a encolher, e o nome do estilo começa a quebrar. */}
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {padraoDoEstudio && (
            <button
              type="button"
              onClick={() => {
                setPreset("");
                setEstilo("");
              }}
              aria-pressed={preset === "" && estilo === ""}
              className={`rounded-xl border p-3 text-left transition ${
                preset === "" && estilo === "" ? "border-acento bg-carbon-2" : "border-linha hover:bg-carbon"
              }`}
            >
              <AmostraDoPreset aparencia={padraoDoEstudio} className="mb-2 h-28 w-full" />
              <span className="block truncate text-sm font-medium">
                Meu padrão
                {(() => {
                  const igual = estilosDoEstudio.find((e) => mesmaAparencia(e.aparencia, padraoDoEstudio));
                  return igual ? <span className="font-normal text-texto-faint"> · {igual.nome}</span> : null;
                })()}
              </span>
              <span className="mt-0.5 block text-xs text-texto-faint">
                O design que você salvou.
              </span>
            </button>
          )}
          {/* Os estilos salvos do estúdio (até cinco) vêm logo depois do
              padrão: são dele, e são o que ele procura antes dos nossos. */}
          {estilosDoEstudio.map((e) => {
            const escolhido = estilo === e.id;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  setEstilo(escolhido ? "" : e.id);
                  setPreset("");
                }}
                aria-pressed={escolhido}
                className={`rounded-xl border p-3 text-left transition ${
                  escolhido ? "border-acento bg-carbon-2" : "border-linha hover:bg-carbon"
                }`}
              >
                <AmostraDoPreset aparencia={e.aparencia} className="mb-2 h-28 w-full" />
                <span className="block truncate text-sm font-medium">{e.nome}</span>
                <span className="mt-0.5 block text-xs text-texto-faint">Um estilo seu.</span>
              </button>
            );
          })}
          {PRESETS.map((p) => {
            const escolhido = preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPreset(escolhido ? "" : p.id);
                  setEstilo("");
                }}
                aria-pressed={escolhido}
                className={`rounded-xl border p-3 text-left transition ${
                  escolhido ? "border-acento bg-carbon-2" : "border-linha hover:bg-carbon"
                }`}
              >
                {/*
                  ── A AMOSTRA MOSTRAVA DOIS EIXOS DE CINCO (25/09/2026) ─────

                  Juan: "essas prévias dos estilos não fazem sentido, tem
                  várias super iguais, não dá pra perceber qual a diferença
                  entre elas. Pra mim a 'ateliê', 'marfim' e 'caligrafia' são
                  iguais. Convite e revista também."

                  Aqui era uma tarja de 56 px com o fundo do tema e o nome na
                  fonte do título — tema e tipografia, e mais nada. O que
                  separa "Ateliê" de "Marfim" é a CAPA: um abre com foto ao
                  lado do nome, o outro abre sem foto nenhuma. Nada disso
                  chegava à tela, então os dois eram o mesmo retângulo creme
                  com a mesma manuscrita, e ele estava descrevendo o que via.

                  `AmostraDoPreset` desenha a página em miniatura, e é a mesma
                  do editor de Design — eram duas amostras diferentes para a
                  mesma decisão, cada uma mostrando metade.
                */}
                <AmostraDoPreset aparencia={p.aparencia} className="mb-2 h-28 w-full" />
                <span className="block text-sm font-medium">{p.nome}</span>
                <span className="mt-0.5 block text-xs text-texto-faint">{p.desc}</span>
              </button>
            );
          })}
        </div>
        {/* A logo é formulário, não amostra: não acompanha a grade. */}
        {slotLogo && <div className="mt-6 max-w-2xl">{slotLogo}</div>}
      </div>

      <div className={etapa === 2 ? "mt-6 max-w-2xl" : "hidden"}>
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
        {/* Pastas vivem dos capítulos: com menos de dois, o cliente vê a
            galeria de sempre (ver `lib/formato-da-entrega.ts`). Dito aqui,
            onde se decide, e não depois de a galeria nascer sem pasta. */}
        {formatosLiberados && formato === "pastas" && capitulos.length < 2 && (
          <p className="mt-3 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-xs text-alerta">
            Você escolheu entregar em pastas: cada capítulo vira uma pasta. Marque pelo menos dois
            — ou, se for enviar a pasta do casamento já separada em subpastas, os capítulos
            nascem delas no envio.
          </p>
        )}
        <p className="mt-3 text-xs text-texto-faint">
          {capitulos.length === 0
            ? "Nenhum escolhido — a galeria fica numa sequência só, o que também funciona."
            : `${capitulos.length} ${capitulos.length === 1 ? "capítulo" : "capítulos"}, na ordem em que você marcou.`}
        </p>
      </div>

      <Erro mensagem={estado.erro} />
      {subindoClipe && (
        <p role="status" className="mt-4 text-sm text-texto-soft">
          Galeria criada. Enviando a capa em vídeo… você é levado a ela em seguida.
        </p>
      )}
      {falhaDoClipe && galeriaCriada && (
        <p role="alert" className="mt-4 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-sm text-alerta">
          A galeria foi criada, mas a capa em vídeo não subiu: {falhaDoClipe}{" "}
          <a href={`/painel/galerias/${galeriaCriada}/design`} className="underline underline-offset-4">
            Abrir a galeria
          </a>{" "}
          e tentar de novo em Design → Capa.
        </p>
      )}

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
        {!semNome && (
          <Botao
            ultima={etapa === ETAPAS.length - 1}
            /* O clipe ainda sendo preparado não sobe junto: criar agora faria
               uma galeria sem a capa que a pessoa acabou de escolher. */
            bloqueado={(comVideo && preparandoClipe) || subindoClipe || Boolean(falhaDoClipe)}
          />
        )}
      </div>
    </form>
  );
}
