"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  OPCOES,
  PRESETS,
  presetEquivalente,
  FONTES_TITULO,
  VIEWPORTS_PREVIA,
  TEMAS,
  type Aparencia,
  type ViewportPrevia,
} from "@/config/aparencia";
import { salvarAparenciaAction, salvarRascunhoAparenciaAction } from "@/app/painel/actions";

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
  { chave: "texto", variavel: "--g-texto", titulo: "Texto" },
  { chave: "destaque", variavel: "--g-destaque", titulo: "Botões" },
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
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {ROTULOS_DE_COR.map(({ chave, variavel, titulo }) => {
          const atual = ap.cores?.[chave] ?? doTema[variavel];
          const propria = Boolean(ap.cores?.[chave]);
          return (
            <label
              key={chave}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition ${
                propria
                  ? "border-acento bg-acento/10 text-acento-alto"
                  : "border-linha text-texto-soft hover:border-linha-forte hover:text-texto"
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
const GRUPOS = [
  { id: "estilos", nome: "Estilos prontos" },
  { id: "capa", nome: "Capa" },
  { id: "tipografia", nome: "Tipografia" },
  { id: "cor", nome: "Cor" },
  { id: "grade", nome: "Grade" },
] as const;
type Grupo = (typeof GRUPOS)[number]["id"];

export function EditorAparencia({
  galeriaId,
  caminhoPublico,
  inicial,
  publicado,
  temFontePropria,
  slotCapa,
}: {
  galeriaId: string;
  caminhoPublico: string;
  /** A área de escolher a capa. Vem montada do servidor: a URL da imagem é
      assinada lá, e este componente é de cliente. Fica no grupo "Capa". */
  slotCapa?: ReactNode;
  /** O que a tela abre mostrando: o rascunho, se houver, senão o publicado. */
  inicial: Aparencia;
  /** O que o CLIENTE vê hoje. É contra isto que a barra decide se aparece. */
  publicado: Aparencia;
  /** O estúdio enviou uma fonte? Decide se a opção aparece no seletor. */
  temFontePropria: boolean;
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
                        : "text-texto-soft hover:bg-carbon hover:text-texto"
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
          )}
          {grupo === "capa" && (
            <>
              {slotCapa}
              <Eixo eixo="capa" titulo="Desenho da capa" ap={ap} mudar={mudar} />
              <Eixo eixo="logo" titulo="Tamanho da logo" ap={ap} mudar={mudar} />
              {/* Junto do desenho da capa porque é a MESMA decisão vista de
                  outro lado: escolher "imersa" e depois "baixa" é dizer foto em
                  tela cheia, mas não a tela inteira. */}
              <Eixo eixo="alturaCapa" titulo="Altura da capa" ap={ap} mudar={mudar} />
            </>
          )}
          {grupo === "tipografia" && (
            <>
              <SeletorDeFonte ap={ap} mudar={mudar} temFontePropria={temFontePropria} />
              {/* Junto da fonte, e não da logo: quem acha o título grosso está
                  olhando para a LETRA, e é ali que ele procura. */}
              <Eixo eixo="peso" titulo="Grossura do título" ap={ap} mudar={mudar} />
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
            <iframe
              key={JSON.stringify(apPrevia)}
              src={`${caminhoPublico}&amostra=1&ap=${encodeURIComponent(JSON.stringify(apPrevia))}`}
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
