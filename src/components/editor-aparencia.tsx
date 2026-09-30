"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  OPCOES,
  PRESETS,
  presetEquivalente,
  mesmaAparencia,
  FONTES_TITULO,
  VIEWPORTS_PREVIA,
  PALETAS,
  TEMAS,
  TAMANHO_TITULO,
  temPesoLeve,
  comFormatoDe,
  type Aparencia,
  type Formato,
  type ViewportPrevia,
} from "@/config/aparencia";
import {
  salvarAparenciaAction,
  salvarRascunhoAparenciaAction,
  salvarPadraoDoEstudioAction,
  esquecerPadraoDoEstudioAction,
  salvarEstiloAction,
  renomearEstiloAction,
  apagarEstiloAction,
  tornarEstiloPadraoAction,
} from "@/app/painel/actions";
import type { EstiloDoEstudio } from "@/lib/estilos-do-estudio";
import { useAvisoDeSaida } from "@/lib/aviso-de-saida-client";
import { AmostraDoPreset } from "@/components/amostra-do-preset";

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
                          : "border-linha text-texto-soft hover:border-acento hover:bg-acento/5 hover:text-texto"
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

/**
 * A BARRINHA DO TAMANHO DO TÍTULO.
 *
 * Felipe, 16/09/2026: "poderia ter um tipo de barrinha que a gente pudesse
 * definir o tamanho do texto dentro do mesmo espaço de formatação".
 *
 * ── POR QUE NÃO É UM EIXO DE PASTILHAS COMO OS OUTROS ────────────────────
 *
 * Todo eixo desta tela é uma escolha entre coisas com NOME: capa imersa ou
 * jornal, canto reto ou redondo. Tamanho não tem nome — tem mais e menos, e é
 * a única pergunta desta tela cuja resposta a pessoa encontra ARRASTANDO até
 * ficar bonito, olhando a prévia. Três pastilhas ("pequeno, médio, grande")
 * dariam três respostas onde ele quer um contínuo, e foi exatamente isso que o
 * pedido descartou: ele quer ver o nome passar de uma linha para duas enquanto
 * puxa.
 *
 * O número aparece à direita porque um controle sem leitura é um controle que
 * a pessoa não sabe desfazer — com ele dá para voltar a 100% de propósito.
 *
 * `onChange` grava a cada passo, e não só ao soltar: é o mesmo caminho dos
 * outros eixos (`mudar`), que já segura a recarga da prévia por 400 ms. Sem
 * isso a prévia só reagiria no fim do arrasto, e o arrasto é a informação.
 */
function BarraDoTitulo({ ap, mudar }: PecaProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor="tamanho-titulo" className="block text-xs font-medium text-texto-soft">
          Tamanho do título
        </label>
        <span className="font-mono text-[11px] text-texto-faint">{ap.tamanhoTitulo}%</span>
      </div>
      <input
        id="tamanho-titulo"
        type="range"
        min={TAMANHO_TITULO.min}
        max={TAMANHO_TITULO.max}
        step={TAMANHO_TITULO.passo}
        value={ap.tamanhoTitulo}
        onChange={(e) => mudar({ ...ap, tamanhoTitulo: Number(e.target.value) })}
        className="mt-2 w-full accent-acento"
      />
      <p className="mt-1 text-[11px] leading-snug text-texto-faint">
        Multiplica o tamanho que a capa escolhida já usa — 100% é o de sempre.
      </p>
    </div>
  );
}

/*
 * ── AS CORES PRÓPRIAS (05/09/2026) ───────────────────────────────────────
 *
 * Três seletores nativos (`<input type="color">`), e não uma biblioteca: o
 * navegador já tem um seletor de cor com conta-gotas, e ele sempre emite
 * `#rrggbb` minúsculo — exatamente o formato que `lerCores` aceita. Nada a
 * instalar, nada a manter.
 *
 * O valor inicial de cada seletor é a cor que o TEMA já usa, e não preto: quem
 * abre o seletor começa de onde a galeria está, e não de um preto que ninguém
 * escolheu. Só passa a existir em `ap.cores` quando a pessoa muda algo.
 *
 * "Voltar às cores do tema" apaga o campo inteiro, e não zera cada cor: sem
 * `cores` a galeria volta a casar com o preset e a tela volta a dizer "no ar:
 * Átomo" em vez de "personalizado".
 */
const ROTULOS_DE_COR = [
  { chave: "fundo", variavel: "--g-fundo", titulo: "Fundo" },
  /* O título vem antes do texto porque é o primeiro que se lê na capa, e
     porque a razão de existir dele é ser DIFERENTE do texto (Felipe,
     28/09/2026): lado a lado, a escolha fica óbvia. Parte da cor do texto,
     que é a que ele herda até alguém mexer. */
  { chave: "titulo", variavel: "--g-texto", titulo: "Título" },
  { chave: "texto", variavel: "--g-texto", titulo: "Texto" },
  { chave: "destaque", variavel: "--g-destaque", titulo: "Botões" },
  /* Fica por último porque é a mais fina das quatro: as três de cima pintam a
     galeria inteira, esta pinta a sobrancelha, a data e a assinatura da capa.
     "Detalhes da capa" e não "Detalhes": a pessoa precisa saber ONDE vai ver o
     efeito, senão escolhe uma cor e conclui que o seletor está quebrado. */
  { chave: "detalhe", variavel: "--g-suave", titulo: "Detalhes da capa" },
] as const;

function CoresProprias({ ap, mudar }: PecaProps) {
  const doTema = TEMAS[ap.tema];
  const temCorPropria = Boolean(ap.cores && Object.keys(ap.cores).length);

  function definir(chave: (typeof ROTULOS_DE_COR)[number]["chave"], valor: string) {
    mudar({ ...ap, cores: { ...(ap.cores ?? {}), [chave]: valor } });
  }
  function voltarAoTema() {
    const { cores: _apagar, ...semCores } = ap;
    void _apagar;
    mudar(semCores);
  }

  return (
    <div>
      <span className="block text-xs font-medium text-texto-soft">Cores próprias</span>
      <p className="mt-0.5 text-[11px] leading-snug text-texto-faint">
        Por cima do tema. O resto da paleta acompanha.
      </p>
      {/*
        AS CARTELAS VÊM ANTES DOS SELETORES, e a ordem é a resposta ao pedido.

        Juan: "essas principais cores que aparecem são difíceis de encaixar.
        Talvez alguma cartela de cores diferentes?" O que ele viu foi o seletor
        do sistema — vermelho, verde e azul puros —, cores de interface que não
        encaixam em galeria de casamento.

        Cada pastilha escolhe as TRÊS cores juntas, que é onde estava a
        dificuldade: achar um verde é fácil, achar um verde que combine com o
        fundo e com o texto é trabalho de designer. Depois de clicar, os três
        seletores continuam logo abaixo — a cartela é ponto de partida, não
        gaiola.
      */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {PALETAS.map((p) => {
          const ativa =
            ap.cores?.fundo === p.cores.fundo &&
            ap.cores?.texto === p.cores.texto &&
            ap.cores?.destaque === p.cores.destaque;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => mudar({ ...ap, cores: { ...p.cores } })}
              aria-pressed={ativa}
              title={`${p.nome} — fundo, texto e botão`}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] transition ${
                ativa
                  ? "border-acento bg-acento/10 text-acento-alto"
                  : "border-linha text-texto-soft hover:border-acento hover:bg-acento/5 hover:text-texto"
              }`}
            >
              {/* As três cores desenhadas, e não só o nome: "Terracota" não diz
                  qual terracota, e a amostra decide a escolha em meio segundo. */}
              <span
                aria-hidden="true"
                className="flex h-4 w-9 shrink-0 overflow-hidden rounded-[3px] border border-linha"
              >
                <span className="flex-1" style={{ background: p.cores.fundo }} />
                <span className="flex-1" style={{ background: p.cores.texto }} />
                <span className="flex-1" style={{ background: p.cores.destaque }} />
              </span>
              {p.nome}
            </button>
          );
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {ROTULOS_DE_COR.map(({ chave, variavel, titulo }) => {
          /* O título herda o texto: sem cor própria, o seletor dele começa na
             cor do texto de agora, própria ou do tema. */
          const atual =
            ap.cores?.[chave] ?? (chave === "titulo" ? ap.cores?.texto : undefined) ?? doTema[variavel];
          const propria = Boolean(ap.cores?.[chave]);
          return (
            <label
              key={chave}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition ${
                propria
                  ? "border-acento bg-acento/10 text-acento-alto"
                  : "border-linha text-texto-soft hover:border-acento hover:bg-acento/5 hover:text-texto"
              }`}
            >
              <input
                type="color"
                value={atual}
                onChange={(e) => definir(chave, e.target.value)}
                aria-label={`Cor de ${titulo.toLowerCase()}`}
                className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              {titulo}
            </label>
          );
        })}
        {temCorPropria && (
          <button
            type="button"
            onClick={voltarAoTema}
            className="text-[11px] text-texto-faint underline underline-offset-4 transition hover:text-texto"
          >
            voltar às cores do tema
          </button>
        )}
      </div>
    </div>
  );
}

/** O que a galeria tem hoje, contado pela página do Design. */
export interface ConteudoDaGaleria {
  /** Grupos com arquivo: cada capítulo com algo dentro, mais as soltas. */
  grupos: number;
  videos: number;
  fotos: number;
}

/**
 * O esquema de cada formato — uma tela em miniatura, e não um ícone.
 *
 * A estratégia de marca pede para DEMONSTRAR, não declarar (§9): "pastas" e
 * "stream" escritos numa pastilha fazem a pessoa imaginar; o desenho da tela
 * que o cliente vai ver responde antes de ela perguntar. A prévia ao lado
 * mostra a galeria de verdade — isto é só o mapa para escolher.
 */
function EsquemaDoFormato({ formato }: { formato: Formato }) {
  const bloco = "rounded-[2px] bg-texto-faint/30";
  if (formato === "pastas") {
    return (
      <div className="grid h-full grid-cols-3 gap-1.5 p-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="relative flex-1">
              <span className={`absolute inset-0 translate-x-[3px] -translate-y-[3px] ${bloco} opacity-50`} />
              <span className="absolute inset-0 rounded-[2px] bg-texto-faint/60" />
            </div>
            <span className={`h-1 w-3/4 ${bloco}`} />
          </div>
        ))}
      </div>
    );
  }
  if (formato === "stream") {
    return (
      <div className="flex h-full flex-col gap-1 bg-void/60 p-2" aria-hidden>
        <div className="relative flex-1 rounded-[2px] bg-texto-faint/40">
          <span className="absolute bottom-1 left-1 h-1 w-6 rounded-full bg-acento" />
        </div>
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-3 flex-1 ${bloco} ${i === 3 ? "opacity-40" : ""}`} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full grid-cols-4 gap-1 p-2" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} className={bloco} />
      ))}
    </div>
  );
}

/**
 * O grupo Formato: três cartões com o esquema da tela, e o aviso quando a
 * galeria não tem com o que o formato trabalhar.
 *
 * O aviso NÃO bloqueia a escolha. O fotógrafo costuma decidir o formato antes
 * de subir o casamento, e recusar "Stream" numa galeria ainda vazia seria
 * errado. O que a tela faz é dizer, sem rodeio, o que o cliente vai ver HOJE:
 * pastas com um grupo só e stream sem vídeo caem na galeria de sempre (ver
 * `formatoEfetivo` em `lib/formato-da-entrega.ts`).
 */
function SeletorDeFormato({
  ap,
  mudar,
  conteudo,
}: PecaProps & { conteudo: ConteudoDaGaleria | null }) {
  const aviso =
    !conteudo
      ? null
      : ap.formato === "pastas" && conteudo.grupos < 2
        ? "Esta galeria ainda não tem dois capítulos com fotos. Até ter, o cliente vê a galeria de sempre — crie os capítulos na aba Fotos (ou envie a pasta já separada em subpastas)."
        : ap.formato === "stream" && conteudo.videos === 0
          ? "Esta galeria ainda não tem vídeo. Até ter, o cliente vê a galeria de sempre."
          : null;
  return (
    <>
      <div>
        <span className="block text-xs font-medium text-texto-soft">Como a entrega se organiza</span>
        <p className="mt-0.5 text-[11px] leading-snug text-texto-faint">
          A cara (capa, letra, cor) continua a mesma nos três. Trocar de estilo não muda o formato.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPCOES.formato.map((op) => {
          const ativo = ap.formato === op.id;
          return (
            <button
              key={op.id}
              type="button"
              aria-pressed={ativo}
              onClick={() => mudar({ ...ap, formato: op.id })}
              className={`rounded-lg border p-3 text-left transition ${
                ativo ? "border-acento bg-acento/5" : "border-linha hover:border-acento hover:bg-acento/5"
              }`}
            >
              <div className="mb-2 h-20 overflow-hidden rounded-md border border-linha bg-carbon-2">
                <EsquemaDoFormato formato={op.id} />
              </div>
              <span className="block text-sm font-medium">{op.nome}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-texto-faint">{op.desc}</span>
            </button>
          );
        })}
      </div>
      {aviso && (
        <p className="rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2.5 text-xs text-alerta">
          {aviso}
        </p>
      )}
      {ap.formato === "pastas" && (
        <p className="text-[11px] leading-snug text-texto-faint">
          A capa de cada pasta é a primeira foto do capítulo. Para trocar, na aba Fotos passe o
          mouse sobre a foto e clique em <strong>capa da pasta</strong>.
        </p>
      )}
      {ap.formato === "stream" && (
        <p className="text-[11px] leading-snug text-texto-faint">
          Cada capítulo vira uma fileira de episódios, na ordem da aba Fotos. As fotos da entrega
          continuam lá, num botão “Ver as fotos”. A capa de cada vídeo é a que ele ganhou no envio
          — troque na aba Fotos se quiser outra.
        </p>
      )}
    </>
  );
}

/*
 * `keyof typeof OPCOES`, e não `keyof Aparencia`: desde as cores próprias a
 * aparência tem um campo (`cores`) que não é eixo de botões, e o tipo antigo
 * deixaria `<Eixo eixo="cores">` compilar para explodir em `OPCOES.cores`.
 */
function Eixo<K extends keyof typeof OPCOES>({
  eixo,
  titulo,
  ap,
  mudar,
  /* Ids que não aparecem nesta galeria. Hoje só o `propria` do eixo da fonte do
     corpo, para quem nunca enviou arquivo: opção morta na tela é pergunta que a
     pessoa faz e ninguém responde — a mesma razão do filtro de `SeletorDeFonte`,
     e o lugar de enviar continua sendo Conta. */
  ocultar,
}: PecaProps & { eixo: K; titulo: string; ocultar?: readonly string[] }) {
  const opcoes = ocultar?.length
    ? OPCOES[eixo].filter((o) => !ocultar.includes(o.id))
    : OPCOES[eixo];
  return (
    <div>
      <span className="block text-xs font-medium text-texto-soft">{titulo}</span>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {opcoes.map((op) => {
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
                  : "border-linha text-texto-soft hover:border-acento hover:bg-acento/5 hover:text-texto"
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

/**
 * Os quatro grupos do ajuste fino, na ordem em que a pessoa costuma decidir:
 * primeiro a cara da capa, depois a letra, a cor e por fim como as fotos se
 * arrumam. É a mesma divisão que o Pixieset usa, e ela casa com a pergunta que
 * o fotógrafo traz — "mudar a letra" é um lugar, não um item no meio de oito.
 */
/*
 * OS ESTILOS PRONTOS SÃO O PRIMEIRO GRUPO, E NÃO UM BLOCO ACIMA DE TUDO.
 *
 * Até 04/09/2026 os nove cartões ficavam empilhados no topo da aba Design, num
 * grid de quatro colunas — três fileiras de cartão com miniatura, nome e
 * descrição. Quem entrava para mudar a letra rolava a tela inteira antes de
 * chegar no menu de ajuste, e foi essa a queixa do Felipe: "continua a edição
 * toda por scroll na mesma tela". As abas existiam; o conteúdo delas é que
 * começava depois de uma tela de outra coisa.
 *
 * Como quinto grupo, os cartões dividem o mesmo espaço dos eixos: um painel de
 * cada vez, e o menu à vista. É também o que a ordem diz — escolher um estilo é
 * a primeira decisão, e por isso ele abre selecionado.
 */
/**
 * Os desenhos de capa que NÃO usam foto — os dois são só tipografia.
 *
 * Escrito à mão, e não deduzido de `OPCOES.capa`: é uma propriedade do
 * COMPONENTE (`galeria-capa.tsx` só lê `urlImagem` nas outras três), e uma
 * lista que se deduz sozinha da tabela de opções concordaria com qualquer capa
 * nova sem ninguém decidir nada. Capa nova entra aqui de propósito, ou não
 * entra de propósito.
 */
/* A jornal saiu daqui em 08/09/2026: ela passou a mostrar a foto abaixo da
   manchete, desde que o fotógrafo tenha escolhido uma. Sobrou a mínima, que é
   só tipografia por definição — é o que o nome dela promete. */
const CAPAS_SEM_FOTO: string[] = ["minima"];
const nomeDaCapa = (id: string) => OPCOES.capa.find((o) => o.id === id)?.nome ?? id;

const GRUPOS = [
  /* "Estilos", e não mais "Estilos prontos": desde 26/09/2026 o primeiro
     cartão é o padrão do estúdio, que não é pronto nosso — é dele. */
  { id: "estilos", nome: "Estilos" },
  /* Logo depois dos estilos: é a outra decisão grande — o estilo diz a cara,
     o formato diz como a entrega se organiza. Ver `Formato`. */
  { id: "formato", nome: "Formato" },
  { id: "capa", nome: "Capa" },
  { id: "tipografia", nome: "Tipografia" },
  { id: "cor", nome: "Cor" },
  { id: "grade", nome: "Grade" },
] as const;
type Grupo = (typeof GRUPOS)[number]["id"];

export function EditorAparencia({
  galeriaId,
  caminhoPublico,
  versaoDaCapa,
  inicial,
  publicado,
  temFontePropria,
  padraoDoEstudio = null,
  estilosDoEstudio = [],
  slotCapa,
  conteudo = null,
}: {
  /** O que a galeria tem hoje — só para o grupo Formato avisar quando a
      escolha não tem com o que trabalhar (pastas sem capítulo, stream sem
      vídeo). Null = não sabemos, e aí nada é dito. */
  conteudo?: ConteudoDaGaleria | null;
  galeriaId: string;
  caminhoPublico: string;
  /** Resumo curto da capa GRAVADA. Muda quando ela muda, e é o que faz a
      prévia recarregar — a capa não viaja no `?ap=` porque não é aparência. */
  versaoDaCapa: string;
  /** A área de escolher a capa. Vem montada do servidor: a URL da imagem é
      assinada lá, e este componente é de cliente. Fica no grupo "Capa". */
  slotCapa?: ReactNode;
  /** O que a tela abre mostrando: o rascunho, se houver, senão o publicado. */
  inicial: Aparencia;
  /** O que o CLIENTE vê hoje. É contra isto que a barra decide se aparece. */
  publicado: Aparencia;
  /** O estúdio enviou uma fonte? Decide se a opção aparece no seletor. */
  temFontePropria: boolean;
  /** O design que o estúdio salvou como padrão, ou null se nunca salvou. Ver
      `padraoDoEstudio` em lib/aparencia-galeria.ts. */
  padraoDoEstudio?: Aparencia | null;
  /** Os até cinco estilos salvos do estúdio, com nome (28/09/2026). Ver
      `lib/estilos-do-estudio.ts`. */
  estilosDoEstudio?: EstiloDoEstudio[];
}) {
  /* Qual grupo do ajuste fino está aberto. Só desenho: não entra no rascunho
     nem na publicação — trocar de grupo não é mexer na galeria. */
  const [grupo, setGrupo] = useState<Grupo>("estilos");
  const [ap, setAp] = useState<Aparencia>(inicial);
  /* O que está GRAVADO. Separado do que está na tela: é a diferença entre os
     dois que acende o botão e diz o que ainda não foi publicado. */
  const [salvo, setSalvo] = useState<Aparencia>(publicado);
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

  /*
   * ── A PRÉVIA NO TAMANHO DE UMA TELA (05/09/2026) ─────────────────────────
   *
   * O iframe é renderizado no tamanho de uma tela de verdade e REDUZIDO em
   * escala para caber na coluna. A galeria dentro dele bate nos mesmos
   * breakpoints e desenha as mesmas proporções que o cliente vai ver; só
   * aparece menor. Ver `VIEWPORTS_PREVIA` para o porquê dos dois tamanhos.
   *
   * A largura da coluna sai de um ResizeObserver, e não de CSS, porque `calc()`
   * não divide comprimento por comprimento — `100cqw / 1280px` não é número
   * válido. O observador dispara sozinho ao começar a observar, então não há
   * setState síncrono dentro do efeito (que é o que a regra
   * `set-state-in-effect` recusa, com razão).
   *
   * O OBSERVADOR SÓ CONHECE A COLUNA; a escala é conta feita no render.
   * A primeira versão calculava a escala DENTRO do observador, com o viewport
   * do render em que ele nasceu, e recriava o observador a cada troca de
   * viewport. Resultado medido em 05/09: a escala aplicada era sempre a do
   * viewport ANTERIOR — o observador velho e o novo disputavam o mesmo estado
   * com closures diferentes. Separar "quanto mede a coluna" (fato do DOM, um
   * observador para a vida toda) de "quanto encolher" (função do viewport
   * escolhido, calculada agora) elimina a corrida por construção.
   *
   * Nunca amplia: no celular a coluna é mais larga que 390 px, e um telefone
   * desenhado a 2,5× seria uma mentira do outro lado.
   */
  const [viewport, setViewport] = useState<ViewportPrevia>("computador");
  const vp = VIEWPORTS_PREVIA.find((v) => v.id === viewport) ?? VIEWPORTS_PREVIA[0];
  const moldura = useRef<HTMLDivElement>(null);
  const [larguraColuna, setLarguraColuna] = useState(0);
  useEffect(() => {
    const el = moldura.current;
    if (!el) return;
    /* A moldura muda de ALTURA quando a escala muda, e isso também acorda o
       observador — mas a largura vem igual, o estado não muda, e o React não
       renderiza de novo. Sem laço. */
    const observador = new ResizeObserver(([entrada]) => {
      setLarguraColuna(Math.round(entrada.contentRect.width));
    });
    observador.observe(el);
    return () => observador.disconnect();
  }, []);
  /* Antes de medir (servidor e primeira pintura) fica em 1: o quadro nasce
     cortado por um instante e assenta na hidratação. Chutar uma escala aqui
     seria acertar num tamanho de tela e errar em todos os outros. */
  const escala = larguraColuna > 0 ? Math.min(1, larguraColuna / vp.largura) : 1;

  /*
   * ── SALVAR COMO PADRÃO DO ESTÚDIO (16/09/2026) ─────────────────────────
   *
   * Felipe: "adicionar algum método de 'salvar padrão criado', para sempre se
   * repetir na hora do design da capa".
   *
   * O que vale é o que está no tenant, e salvar não mexe em galeria nenhuma —
   * nem nesta: é uma decisão sobre o que vem DEPOIS. Ver
   * `salvarPadraoDoEstudioAction`.
   *
   * ── O ESTADO GUARDA O DESENHO, E NÃO SÓ "EXISTE UM" (26/09/2026) ───────
   *
   * Até aqui era um booleano, para escolher o recado. E o padrão salvo não
   * aparecia em lugar nenhum: não virava cartão em Estilos, não aparecia na
   * criação da galeria, e a tela nunca dizia "esta galeria está no seu
   * padrão". Os sócios salvaram e não conseguiram mais achar — "os estilos
   * salvos não estão fácil de achar, não conseguimos descobrir onde estão".
   *
   * Guardar a aparência inteira é o que deixa o padrão ser MOSTRADO (o
   * primeiro cartão de Estilos, com a mesma amostra dos outros) e APLICADO a
   * uma galeria que já existe, que antes não tinha caminho nenhum.
   */
  const [padrao, setPadrao] = useState<{ aparencia: Aparencia | null; recado: string }>({
    aparencia: padraoDoEstudio,
    recado: "",
  });
  const noPadrao = padrao.aparencia !== null && mesmaAparencia(ap, padrao.aparencia);

  /*
   * ── MEUS ESTILOS: ATÉ CINCO, COM NOME (28/09/2026) ─────────────────────
   *
   * Juan: "Ela pode salvar até 5 padrões próprios e dar nome pra eles. Eu
   * criei uns 3 que eu gostei, mas só pode salvar um." O padrão continua
   * sendo UM — o design com que a galeria nova nasce —, e os estilos são as
   * combinações que o fotógrafo quer ter à mão. Qualquer um vira o padrão com
   * um clique. A lista na tela é sempre a que o servidor devolveu.
   */
  const [estilos, setEstilos] = useState<EstiloDoEstudio[]>(estilosDoEstudio);
  const [nomeNovo, setNomeNovo] = useState("");
  const [renomeando, setRenomeando] = useState<{ id: string; nome: string } | null>(null);
  const [recadoEstilos, setRecadoEstilos] = useState("");
  const estiloNoAr = estilos.find((e) => mesmaAparencia(ap, e.aparencia));
  const cheio = estilos.length >= 5;

  function comEstilos(
    acao: (f: FormData) => Promise<{ ok?: string; erro?: string; estilos?: EstiloDoEstudio[] }>,
    campos: Record<string, string>,
    depois?: () => void,
  ) {
    iniciar(async () => {
      const f = new FormData();
      for (const [k, v] of Object.entries(campos)) f.set(k, v);
      const r = await acao(f);
      if (r.estilos) setEstilos(r.estilos);
      setRecadoEstilos(r.erro ?? r.ok ?? "");
      if (!r.erro) depois?.();
    });
  }

  const presetAtivo = presetEquivalente(ap);
  const sujo = JSON.stringify(ap) !== JSON.stringify(salvo);

  /*
   * ── O RASCUNHO VOLTA A GRAVAR SOZINHO (01/09/2026) ───────────────────────
   *
   * O botão trouxe um jeito de perder trabalho que o salvamento automático não
   * tinha: escolher e sair sem apertar. Custou isso no mesmo dia, com a primeira
   * usuária de verdade — escolheu o tema claro, viu a prévia ficar branca, saiu,
   * e a galeria seguiu preta.
   *
   * O erro não foi pôr o botão; foi ter deixado a escolha existir SÓ na memória
   * do navegador. Agora ela grava sozinha em `aparencia_rascunho`, que o cliente
   * nunca vê — e publicar continua sendo o único jeito de mexer no que ele vê.
   *
   * Guardar em localStorage seria mais barato e resolveria menos: quem escolhe
   * no celular e volta no computador é justamente o caso de quem está
   * experimentando.
   *
   * A mesma espera de 400 ms serve às duas coisas — recarregar o iframe e gravar
   * o rascunho —, porque as duas querem a ÚLTIMA escolha, não as quatro do
   * caminho.
   */
  function mudar(novo: Aparencia) {
    setAp(novo);
    setErro(null);
    if (agendado.current) clearTimeout(agendado.current);
    agendado.current = setTimeout(() => {
      setApPrevia(novo);
      /* Fora da transição de propósito: gravar rascunho não pode acender o
         "Publicando…" nem desabilitar o botão que a pessoa está prestes a
         apertar. Falha aqui é silenciosa porque o trabalho continua na tela —
         quem avisa é a barra, que só some quando a publicação confirma. */
      void salvarRascunhoAparenciaAction(corpo(novo));
    }, 400);
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
   * Sair com aparência não publicada AVISA.
   *
   * Não substitui o botão, e nem tenta: é a rede para o gesto que ninguém
   * planeja.
   *
   * Até 16/09/2026 valia só para fechar a aba, e o comentário aqui dizia que a
   * navegação dentro do painel ficava por conta da barra fixa. Duas usuárias já
   * tinham provado que a barra não basta (ver `testar-previa.mjs`), e o Felipe
   * pediu o aviso para as duas telas — esta e a de envio. A escolha continua
   * gravada no rascunho, então o que se perde não é o trabalho: é a publicação,
   * e é isso que a frase diz.
   */
  useAvisoDeSaida(
    sujo,
    "Você tem mudanças de aparência que ainda não foram publicadas. " +
      "Elas ficam guardadas, mas o seu cliente continua vendo a galeria anterior. Sair assim mesmo?",
  );

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
              : noPadrao
                ? "no ar: meu padrão"
                : estiloNoAr
                  ? `no ar: ${estiloNoAr.nome}`
                  : `no ar: ${PRESETS.find((p) => p.id === presetAtivo)?.nome ?? "personalizado"}`)}
        </span>
      </div>

      {/*
        AJUSTE FINO EM QUATRO GRUPOS (04/09/2026).

        Eram oito peças num grid de duas colunas, dentro de um `<details>`
        fechado. O sócio apontou o Pixieset, que separa a mesma coisa num menu:
        Capa, Tipografia, Cor, Grade. A divisão é boa porque casa com a
        pergunta que a pessoa traz — ela não vem "ajustar a aparência", vem
        "mudar a letra" ou "deixar a capa diferente".

        ── POR QUE NÃO SÃO ROTAS, COMO AS ABAS DE CIMA ──────────────────────

        As quatro abas da galeria (fotos, design, entrega, atividade) são rotas
        de verdade, e isso vale a pena porque cada uma carrega dados diferentes.
        Aqui não: os quatro grupos mexem no MESMO rascunho e são publicados pelo
        MESMO botão. Em rotas separadas, ou o rascunho se perderia ao trocar de
        grupo, ou o estado teria de subir para um layout — complexidade sem
        ganho nenhum, porque não há dado novo para buscar. Trocar de grupo aqui
        é trocar o que está desenhado, e nada mais.
      */}
      <div className="mt-5 border-t border-linha pt-4 sm:flex sm:gap-6">
        <nav aria-label="Partes do design" className="sm:w-36 sm:shrink-0">
          <span className="block text-[10px] font-mono uppercase tracking-widest text-texto-faint">
            Editar
          </span>
          <ul className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1 sm:mx-0 sm:flex-col sm:overflow-visible sm:px-0">
            {GRUPOS.map((g) => {
              const ativo = grupo === g.id;
              return (
                <li key={g.id} className="shrink-0 sm:shrink">
                  <button
                    type="button"
                    aria-pressed={ativo}
                    onClick={() => setGrupo(g.id)}
                    className={`w-full whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-xs transition ${
                      ativo
                        ? "bg-carbon-2 font-medium text-texto"
                        : "text-texto-soft hover:bg-acento/10 hover:text-texto"
                    }`}
                  >
                    {g.nome}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-4 grid min-w-0 flex-1 gap-4 sm:mt-0">
          {grupo === "estilos" && (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {/*
                O PADRÃO DO ESTÚDIO É O PRIMEIRO CARTÃO (26/09/2026).

                Ele é a escolha de sempre do fotógrafo, então vem antes das
                nossas. Mesma amostra e mesmo gesto dos outros cartões: um
                clique aplica nesta galeria, e publicar continua sendo o único
                jeito de o cliente ver.

                Sem padrão salvo, o lugar fica reservado por um aviso tracejado
                que diz onde ele nasce — quem procura o recurso acha a porta
                aqui, que é onde se escolhe estilo, e não só lá embaixo.
              */}
              {padrao.aparencia ? (
                <button
                  type="button"
                  onClick={() => padrao.aparencia && mudar(comFormatoDe(padrao.aparencia, ap))}
                  className={`rounded-lg border p-3 text-left transition ${
                    noPadrao
                      ? "border-acento bg-acento/5"
                      : "border-linha hover:border-acento hover:bg-acento/5"
                  }`}
                >
                  <AmostraDoPreset aparencia={padrao.aparencia} className="mb-2 h-20 w-full" />
                  {/* Quando o padrão é um dos estilos salvos, o cartão diz qual —
                      senão parecem dois estilos iguais sem explicação. */}
                  <span className="block truncate text-sm font-medium">
                    Meu padrão
                    {(() => {
                      const igual = estilos.find((e) => padrao.aparencia && mesmaAparencia(e.aparencia, padrao.aparencia));
                      return igual ? <span className="font-normal text-texto-faint"> · {igual.nome}</span> : null;
                    })()}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-texto-faint">
                    O design que você salvou. Toda galeria nova já nasce assim.
                  </span>
                </button>
              ) : (
                <div className="rounded-lg border border-dashed border-linha-forte p-3">
                  <span className="block text-sm font-medium text-texto-soft">Meu padrão</span>
                  <span className="mt-1 block text-[11px] leading-snug text-texto-faint">
                    Monte o seu design e aperte{" "}
                    <strong className="font-medium text-texto-soft">Salvar como meu padrão</strong>,
                    logo abaixo. Ele passa a aparecer aqui e na criação de toda galeria nova.
                  </span>
                </div>
              )}
              {estilos.map((e) => {
                const ativo = mesmaAparencia(ap, e.aparencia);
                const ehPadrao = padrao.aparencia !== null && mesmaAparencia(e.aparencia, padrao.aparencia);
                const editando = renomeando?.id === e.id;
                return (
                  /* Um `div`, e não um botão, em volta: renomear e apagar são
                     botões, e botão dentro de botão é HTML inválido. */
                  <div
                    key={e.id}
                    className={`rounded-lg border p-3 transition ${
                      ativo ? "border-acento bg-acento/5" : "border-linha hover:border-acento"
                    }`}
                  >
                    <button type="button" onClick={() => mudar(comFormatoDe(e.aparencia, ap))} className="block w-full text-left">
                      <AmostraDoPreset aparencia={e.aparencia} className="mb-2 h-20 w-full" />
                    </button>
                    {editando ? (
                      <form
                        onSubmit={(ev) => {
                          ev.preventDefault();
                          comEstilos(renomearEstiloAction, { id: e.id, nome: renomeando.nome }, () =>
                            setRenomeando(null),
                          );
                        }}
                        className="flex items-center gap-1"
                      >
                        <input
                          autoFocus
                          value={renomeando.nome}
                          maxLength={40}
                          onChange={(ev) => setRenomeando({ id: e.id, nome: ev.target.value })}
                          aria-label="Novo nome do estilo"
                          className="min-w-0 flex-1 rounded border border-linha bg-transparent px-2 py-1 text-sm"
                        />
                        <button type="submit" disabled={salvando} className="text-[11px] text-acento">
                          ok
                        </button>
                      </form>
                    ) : (
                      <button type="button" onClick={() => mudar(comFormatoDe(e.aparencia, ap))} className="block w-full text-left">
                        <span className="block truncate text-sm font-medium">{e.nome}</span>
                      </button>
                    )}
                    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-texto-faint">
                      {ehPadrao ? (
                        <span>padrão das galerias novas</span>
                      ) : (
                        <button
                          type="button"
                          disabled={salvando}
                          onClick={() =>
                            iniciar(async () => {
                              const f = new FormData();
                              f.set("id", e.id);
                              const r = await tornarEstiloPadraoAction(f);
                              if (r.padrao) setPadrao({ aparencia: r.padrao, recado: "" });
                              setRecadoEstilos(r.erro ?? r.ok ?? "");
                            })
                          }
                          className="underline-offset-4 hover:text-texto hover:underline"
                        >
                          tornar padrão
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={salvando}
                        onClick={() => setRenomeando(editando ? null : { id: e.id, nome: e.nome })}
                        className="underline-offset-4 hover:text-texto hover:underline"
                      >
                        renomear
                      </button>
                      <button
                        type="button"
                        disabled={salvando}
                        onClick={() => {
                          if (confirm(`Apagar o estilo “${e.nome}”? Nenhuma galeria muda.`)) {
                            comEstilos(apagarEstiloAction, { id: e.id });
                          }
                        }}
                        className="underline-offset-4 hover:text-alerta hover:underline"
                      >
                        apagar
                      </button>
                    </span>
                  </div>
                );
              })}
              {PRESETS.map((p) => {
                const ativo = presetAtivo === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => mudar(comFormatoDe(p.aparencia, ap))}
                    className={`rounded-lg border p-3 text-left transition ${
                      ativo
                        ? "border-acento bg-acento/5"
                        : "border-linha hover:border-acento hover:bg-acento/5"
                    }`}
                  >
                    {/*
                      ── O RABISCO MOSTRAVA UM EIXO DE CINCO (25/09/2026) ────

                      Juan, escolhendo estilo: "tem várias super iguais, não dá
                      pra perceber qual a diferença entre elas".

                      Aqui era um rabisco de 32×24 px com a GRADE e nada de
                      tipografia; no assistente era uma tarja com a TIPOGRAFIA
                      e nada de grade. Duas amostras diferentes para a mesma
                      decisão, e nenhuma das duas desenhava a capa — que é
                      justamente o que separa um preset do outro.

                      Agora é a mesma amostra dos dois lados, e ela desenha a
                      página: capa, título na fonte do preset, grade com a
                      densidade e o canto dele.
                    */}
                    <AmostraDoPreset aparencia={p.aparencia} className="mb-2 h-20 w-full" />
                    <span className="block text-sm font-medium">{p.nome}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-texto-faint">
                      {p.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {grupo === "formato" && (
            <SeletorDeFormato ap={ap} mudar={mudar} conteudo={conteudo} />
          )}
          {grupo === "capa" && (
            <>
              {slotCapa}
              {/*
                "ESCOLHI A CAPA MAS TÁ NÃO APARECENDO" — Juan, 05/09/2026.

                Não era defeito de gravação: ele tinha escolhido a foto de capa
                E o desenho "Jornal", que é o desenho SEM foto — fundo limpo,
                tipografia grande. A tela deixava as duas escolhas conviverem e
                não dizia que uma anulava a outra, então o resultado parecia o
                sistema tendo perdido a foto.

                O aviso só aparece na combinação que causa isso, e resolve com
                um clique: dizer o problema sem dar a saída é metade do trabalho.
              */}
              {CAPAS_SEM_FOTO.includes(ap.capa) && (
                <div className="rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2.5">
                  <p className="text-xs text-alerta">
                    O desenho <strong>{nomeDaCapa(ap.capa)}</strong> não mostra foto de capa — ele é
                    só tipografia. A foto escolhida acima fica guardada, mas não aparece.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {OPCOES.capa
                      .filter((o) => !CAPAS_SEM_FOTO.includes(o.id))
                      .map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => mudar({ ...ap, capa: o.id })}
                          className="rounded-md border border-linha-forte px-2.5 py-1 text-[11px] transition hover:bg-carbon-2"
                        >
                          usar {o.nome}
                        </button>
                      ))}
                  </div>
                </div>
              )}
              <Eixo eixo="capa" titulo="Desenho da capa" ap={ap} mudar={mudar} />
              <Eixo eixo="logo" titulo="Logo" ap={ap} mudar={mudar} />
              {/* Junto do desenho da capa porque é a MESMA decisão vista de
                  outro lado: escolher "imersa" e depois "baixa" é dizer foto em
                  tela cheia, mas não a tela inteira. */}
              <Eixo eixo="alturaCapa" titulo="Altura da capa" ap={ap} mudar={mudar} />
              {/* Junto da altura porque as duas respondem à mesma pergunta —
                  quanto da tela a capa ocupa, e por quanto tempo. */}
              <Eixo eixo="capaFixa" titulo="Ao rolar a página" ap={ap} mudar={mudar} />
              <Eixo eixo="alinhamento" titulo="Alinhamento do texto" ap={ap} mudar={mudar} />

              {/*
                O RÓTULO DO EVENTO — campo de texto, e não um eixo de pastilhas.

                Juan pediu "casamento, aniversário, prewedding, etc", e é o
                "etc" que decide o formato: não existe lista certa. Uma lista de
                botões atenderia os três exemplos e deixaria de fora "chá de
                bebê", "15 anos", "ensaio de família" — e quem precisasse de um
                desses acharia que o produto não serve.

                As sugestões ficam no `placeholder`, que ensina sem limitar.
              */}
              <div>
                <span className="block text-xs font-medium text-texto-soft">
                  Rótulo do evento
                </span>
                <p className="mt-0.5 text-[11px] leading-snug text-texto-faint">
                  Aparece pequeno, acima do título. Deixe vazio para não mostrar nada.
                </p>
                <input
                  value={ap.rotulo}
                  onChange={(e) => mudar({ ...ap, rotulo: e.target.value.slice(0, 40) })}
                  maxLength={40}
                  placeholder="Casamento, Prewedding, 15 anos…"
                  aria-label="Rótulo do evento"
                  className="mt-2 w-full max-w-xs rounded-lg border border-linha bg-void px-3 py-2 text-sm text-texto placeholder:text-texto-faint focus:border-acento focus:outline-none"
                />
              </div>
              {/*
                O CARTÃO DO WHATSAPP MORA AQUI porque é a capa vista de fora: a
                foto que ele usa é a mesma, e quem acabou de escolher a capa é
                quem quer saber como ela chega no celular do casal.

                Carol, 08/09/2026: "não gosto daquele gradiente branco ali,
                queria que fosse mais clean". A linha embaixo diz o que o modo
                limpo faz com o nome, que é a pergunta imediata de quem lê "só a
                foto" — e a resposta é que ele continua ali, escrito pelo próprio
                WhatsApp ao lado da imagem.
              */}
              <div>
                <Eixo eixo="cartao" titulo="Cartão do link no WhatsApp" ap={ap} mudar={mudar} />
                <p className="mt-1.5 text-[11px] leading-snug text-texto-faint">
                  O WhatsApp escreve o nome da galeria e o do estúdio ao lado da imagem — no
                  modo limpo eles continuam aparecendo, só não vão por cima da foto.
                </p>
              </div>
            </>
          )}
          {grupo === "tipografia" && (
            <>
              <SeletorDeFonte ap={ap} mudar={mudar} temFontePropria={temFontePropria} />
              {/* Junto da fonte, e não da logo: quem acha o título grosso está
                  olhando para a LETRA, e é ali que ele procura. */}
              <Eixo eixo="peso" titulo="Grossura do título" ap={ap} mudar={mudar} />
              {/*
                O aviso só aparece quando a fonte escolhida não tem traço mais
                fino — nas outras ele seria ruído. Felipe, 16/09/2026: "a normal
                pra fina não muda nada, só muda da normal para forte". Na
                serifada aquilo era defeito nosso e foi corrigido em
                `layout.tsx`; nestas quinze a família realmente não desenha nada
                abaixo de 400, e dizer isso aqui vale mais que um botão que não
                responde. Mesma conversa que o "sem efeito nas manuscritas" que
                a opção "Forte" já traz.
              */}
              {!temPesoLeve(ap.tipografia) && (
                <p className="-mt-1 text-[11px] leading-snug text-texto-faint">
                  Esta fonte não tem um traço mais fino que o normal — “Fina” desenha igual a
                  “Normal”. Para afinar o título, troque a fonte acima.
                </p>
              )}
              {/* As duas do tamanho vêm juntas porque respondem à mesma
                  pergunta — "como o nome ocupa a capa" — e uma mexe na outra:
                  puxar a barrinha para cima é o que faz o nome procurar a linha
                  de baixo, e é para dar destino a essa quebra que a escolha de
                  linhas existe ao lado. Separadas, a pessoa mexeria numa sem
                  saber que a outra explica o resultado. */}
              <BarraDoTitulo ap={ap} mudar={mudar} />
              <Eixo eixo="linhasTitulo" titulo="Linhas do título" ap={ap} mudar={mudar} />
              {/* Logo abaixo da grossura porque a pergunta é a mesma escada: a
                  letra do título, o peso dela, e então a letra de todo o resto.
                  Marca de fotógrafo costuma ser display — por isso este eixo é
                  independente do de cima e nasce em "A do sistema". */}
              <Eixo
                eixo="fonteTexto"
                titulo="Fonte do texto"
                ap={ap}
                mudar={mudar}
                ocultar={temFontePropria ? undefined : ["propria"]}
              />
              {/* E por fim as letrinhas — a sobrancelha, a data, a assinatura e
                  o botão da capa. Vem depois das outras duas porque as duas
                  opções interessantes dele APONTAM para elas: "a do nome do
                  casal" é o primeiro eixo desta coluna, "a do texto" é o de
                  cima. Escolher nesta ordem é ler a escada de baixo para cima. */}
              <Eixo eixo="fonteDetalhe" titulo="Letrinhas da capa" ap={ap} mudar={mudar} />
            </>
          )}
          {grupo === "cor" && (
            <>
              <Eixo eixo="tema" titulo="Cores" ap={ap} mudar={mudar} />
              <CoresProprias ap={ap} mudar={mudar} />
            </>
          )}
          {grupo === "grade" && (
            <>
              <Eixo eixo="grade" titulo="Grade das fotos" ap={ap} mudar={mudar} />
              <Eixo eixo="densidade" titulo="Espaçamento" ap={ap} mudar={mudar} />
              <Eixo eixo="canto" titulo="Canto das fotos" ap={ap} mudar={mudar} />
            </>
          )}
        </div>
      </div>

      {/*
        ── O PADRÃO DO ESTÚDIO ──────────────────────────────────────────────

        Felipe: "adicionar algum método de salvar padrão criado, para sempre se
        repetir na hora do design da capa".

        Fica DEPOIS dos eixos e ANTES da prévia, e o lugar é a leitura: a pessoa
        acabou de montar a combinação, está olhando para ela, e é aí que faz
        sentido dizer "é esta, sempre". No topo seria uma promessa sobre algo
        que ela ainda não escolheu.

        O texto é explícito sobre o que NÃO acontece — nenhuma galeria muda,
        nem esta. Um botão chamado "salvar" ao lado de doze controles de
        aparência é lido como "aplicar", e aplicar em entregas já feitas seria
        reescrever o trabalho de alguém a partir de um clique.
      */}
      {/*
        MEUS ESTILOS (28/09/2026) — no mesmo lugar e pela mesma razão do
        padrão logo abaixo: a pessoa acabou de montar a combinação e está
        olhando para ela. Salvar não mexe em galeria nenhuma, nem nesta.
      */}
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          comEstilos(salvarEstiloAction, { nome: nomeNovo, aparencia: JSON.stringify(ap) }, () => setNomeNovo(""));
        }}
        className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-linha pt-4"
      >
        <div className="min-w-0">
          <span className="block text-xs font-medium text-texto-soft">
            Meus estilos <span className="font-normal text-texto-faint">· {estilos.length} de 5</span>
          </span>
          <p className="mt-0.5 max-w-[60ch] text-[11px] leading-snug text-texto-faint" role="status" aria-live="polite">
            {recadoEstilos ||
              (cheio
                ? "Você já tem 5 estilos salvos. Apague um em Estilos para guardar outro."
                : "Guarde esta combinação com um nome — ela aparece em Estilos e na criação de toda galeria nova. Nenhuma galeria muda.")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            value={nomeNovo}
            onChange={(ev) => setNomeNovo(ev.target.value)}
            maxLength={40}
            placeholder="Nome do estilo"
            aria-label="Nome do estilo"
            disabled={cheio}
            className="w-40 rounded-lg border border-linha bg-transparent px-3 py-2 text-xs disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={salvando || cheio || !nomeNovo.trim()}
            className="rounded-lg border border-linha-forte px-4 py-2 text-xs transition hover:bg-carbon-2 disabled:opacity-40"
          >
            Salvar estilo
          </button>
        </div>
      </form>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-linha pt-4">
        <div className="min-w-0">
          <span className="block text-xs font-medium text-texto-soft">Padrão do estúdio</span>
          <p className="mt-0.5 max-w-[60ch] text-[11px] leading-snug text-texto-faint">
            {padrao.recado ||
              (padrao.aparencia
                ? "Toda galeria nova nasce com o seu design salvo, e ele fica em Estilos como “Meu padrão”. Salvar de novo substitui o anterior; nenhuma galeria existente muda."
                : "Guarde esta combinação e toda galeria nova já nasce assim — ela fica em Estilos como “Meu padrão”. Nenhuma galeria existente muda, nem esta.")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {padrao.aparencia && (
            <button
              type="button"
              disabled={salvando}
              onClick={() =>
                iniciar(async () => {
                  const r = await esquecerPadraoDoEstudioAction();
                  setPadrao({ aparencia: null, recado: r.ok ?? "" });
                })
              }
              className="rounded-lg px-3 py-2 text-xs text-texto-faint underline underline-offset-4 transition hover:text-texto disabled:opacity-40"
            >
              esquecer
            </button>
          )}
          <button
            type="button"
            disabled={salvando}
            onClick={() =>
              iniciar(async () => {
                const f = new FormData();
                f.set("aparencia", JSON.stringify(ap));
                const r = await salvarPadraoDoEstudioAction(f);
                setPadrao((atual) => ({
                  aparencia: r.erro ? atual.aparencia : ap,
                  recado: r.erro ?? r.ok ?? "",
                }));
              })
            }
            className="rounded-lg border border-linha-forte px-4 py-2 text-xs transition hover:bg-carbon-2 disabled:opacity-40"
          >
            {padrao.aparencia ? "Salvar de novo como padrão" : "Salvar como meu padrão"}
          </button>
        </div>
      </div>

      {/* Prévia */}
      <div className="mt-5 border-t border-linha pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-texto-soft">Prévia</span>
          <div className="flex items-center gap-2">
            {salvando && <span className="text-[11px] text-texto-faint">atualizando…</span>}
            {/* Computador e Celular: o cliente abre nos dois, e a capa muda de
                desenho entre eles. Trocar não recarrega o iframe — só o
                redimensiona, e a galeria reflui como numa janela de verdade. */}
            <div
              role="group"
              aria-label="Tamanho da prévia"
              className="flex gap-0.5 rounded-full border border-linha p-0.5"
            >
              {VIEWPORTS_PREVIA.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={viewport === v.id}
                  onClick={() => setViewport(v.id)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
                    viewport === v.id
                      ? "bg-carbon-2 text-texto"
                      : "text-texto-soft hover:text-texto"
                  }`}
                >
                  {v.nome}
                </button>
              ))}
            </div>
          </div>
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
        {/*
          A MOLDURA tem a largura da coluna e a altura da tela reduzida; o QUADRO
          dentro dela tem o tamanho da tela de verdade e é encolhido por
          `transform`. A galeria mede a si mesma pelo quadro — 1280 px são
          1280 px para os breakpoints dela — e o olho vê tudo menor. É o que faz
          a prévia ser fiel: mesma marcação, mesmas fontes, mesma proporção.

          No celular a escala trava em 1 e o quadro centraliza: um telefone de
          390 px no meio da coluna, no tamanho real.
        */}
        <div
          ref={moldura}
          className="mt-2 overflow-hidden rounded-lg border border-linha bg-void"
          style={{ height: Math.round(vp.altura * escala) }}
        >
          <div
            style={{
              width: vp.largura,
              height: vp.altura,
              transform: `scale(${escala})`,
              transformOrigin: "top left",
              marginInline: viewport === "celular" ? "auto" : undefined,
            }}
          >
            {/* `versaoDaCapa` entra no ENDEREÇO, não só na `key`: remontar o
                elemento pediria a mesma URL de novo, e a mesma URL pode vir do
                cache do navegador — a prévia recarregaria para mostrar a capa
                velha outra vez. Ver o porquê da assinatura na página do Design. */}
            <iframe
              key={`${versaoDaCapa}:${JSON.stringify(apPrevia)}`}
              src={`${caminhoPublico}&amostra=1&capa=${versaoDaCapa}&ap=${encodeURIComponent(JSON.stringify(apPrevia))}`}
              title="Prévia da galeria"
              width={vp.largura}
              height={vp.altura}
              className="block border-0"
              loading="lazy"
            />
          </div>
        </div>

        {/*
          A PRÉVIA É FIEL, MAS NÃO É INTERATIVA NO TAMANHO CERTO.

          Rolar, abrir uma foto, marcar favorita — tudo funciona dentro do
          quadro, mas em miniatura. Quem vai decidir "está bom para o meu
          cliente" merece também a experiência no tamanho real, e é isso que
          este botão dá. Abre em aba nova de propósito: a decisão continua sendo
          tomada aqui, e perder o editor para conferir seria trocar uma pergunta
          por outra.
        */}
        <a
          href={caminhoPublico}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-linha-forte px-4 py-2 text-sm transition hover:bg-carbon-2"
        >
          Visualizar galeria ↗
        </a>
        {/*
          A frase muda quando há escolha não publicada, porque desde 16/09/2026
          o botão passou a abrir o RASCUNHO — era o pedido do Felipe ("clico em
          visualizar a galeria e ele mostra o modo antigo"). Manter "do jeito
          que o seu cliente vê" nesse estado seria a mesma mentira que
          `testar-previa.mjs` guarda do outro lado: o cliente ainda vê o
          anterior, e quem lê a frase precisa saber qual das duas está na tela.
        */}
        <p className="mt-1.5 text-xs text-texto-faint">
          {/* `sujo` já cobre os dois casos: `salvo` nasce do PUBLICADO, então
              ele fica verdadeiro tanto para a escolha de agora quanto para o
              rascunho que a tela abriu. */}
          {sujo
            ? "Abre em tela cheia, com as suas escolhas ainda não publicadas."
            : "Abre em tela cheia, do jeito que o seu cliente vê."}
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
        <div
          className="fixed inset-x-0 bottom-0 z-50 border-t border-linha-forte bg-carbon/95 backdrop-blur"
          /* A barra do Safari no iPhone come o rodapé da página. Sem esta folga
             o botão fica ATRÁS dela — visível pela metade e difícil de acertar,
             que é meio caminho para não ser apertado. */
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
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
                  /* Apaga o rascunho no servidor também: senão a escolha
                     descartada voltaria na próxima vez que a tela abrisse. */
                  void salvarRascunhoAparenciaAction(corpo(salvo));
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

