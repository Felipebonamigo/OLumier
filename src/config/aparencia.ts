/**
 * Aparência da galeria: eixos independentes + presets.
 *
 * Por que eixos em vez de "temas prontos": um template fechado sempre erra para
 * alguém — o Sirius quer capa clara com tipografia grande, a Carol quer creme e
 * serifada, o próximo vai querer outra coisa. Combinando eixos, saem dezenas de
 * resultados sem escrever um template para cada. Os presets existem para quem
 * não quer escolher: um clique e está pronto, e ainda dá para ajustar depois.
 */

export type Capa = "imersa" | "jornal" | "dividida" | "minima" | "convite";
export type Tema = "noite" | "claro" | "creme";
export type Tipografia =
  | "serifada"
  | "playfair"
  | "lora"
  | "moderna"
  | "jost"
  | "raleway"
  | "manuscrita"
  | "parisienne"
  | "petit"
  // segunda leva, 27/08/2026 — três opções por família viravam "nenhuma serve"
  | "garamond"
  | "baskerville"
  | "bodoni"
  | "josefin"
  | "work"
  | "outfit"
  | "dancing"
  | "sacramento"
  | "italianno"
  | "cinzel"
  | "marcellus"
  | "tenor"
  /* A fonte que o próprio estúdio enviou. Não é uma fonte nossa: o arquivo mora
   * no bucket do fotógrafo e a galeria injeta o @font-face. Ver lib/fonte-estudio.ts. */
  | "propria";
export type Grade = "colunas" | "linhas" | "quadrada" | "editorial";
export type Densidade = "compacta" | "normal" | "arejada";

export type TamanhoLogo = "discreta" | "media" | "grande" | "enorme";

/**
 * Quantas fotos a prévia do editor desenha.
 *
 * A prévia é a galeria pública de verdade, renderizada no tamanho de uma tela
 * e reduzida em escala (ver `VIEWPORTS_PREVIA`) — e isso é qualidade do
 * produto, não atalho: o que se vê ali é o que o cliente vê. O custo era
 * carregar a galeria INTEIRA a cada mudança de eixo; com 192 fotos, trocar de
 * fonte assinava 576 URLs e baixava 192 miniaturas para mostrar meia dúzia.
 *
 * Doze fotos enchem a primeira dobra de um computador (grade de quatro colunas,
 * três linhas) com folga para rolar um pouco, sem que a conta dependa do
 * tamanho da entrega. Não é teto de nada além da prévia: o botão "Visualizar
 * galeria" abre a galeria completa, e `testar-previa.mjs` existe principalmente
 * para prender essa diferença.
 */
export const AMOSTRA_PREVIA = 12;

/**
 * ── A PRÉVIA TEM O TAMANHO DE UMA TELA, NÃO DE UMA CAIXA (05/09/2026) ─────
 *
 * Até aqui o iframe da prévia tinha 460 px de altura e a largura do painel. A
 * galeria é desenhada para tela cheia: a capa imersa pede `78vh`, as capas
 * dividida e jornal viram duas colunas a partir de 768 px. Numa caixa de 460 px
 * a capa virava uma faixa, e num notebook o painel ficava abaixo de 768 px e a
 * prévia mostrava o layout de celular — enquanto o cliente, no computador, via
 * outro. O dono disse, com razão: a publicação tem de ser fiel à prévia, porque
 * é na prévia que ele decide.
 *
 * Agora o iframe é renderizado no tamanho de uma tela DE VERDADE e reduzido em
 * escala para caber na coluna. A galeria dentro dele bate nos mesmos
 * breakpoints, desenha as mesmas proporções, carrega as mesmas fontes — só
 * aparece menor. Continua sendo a galeria pública, não uma imitação.
 *
 * Dois tamanhos, porque o cliente do fotógrafo abre em dois lugares: o
 * computador de quem escolhe as fotos do álbum, e o celular de quem recebeu o
 * link no WhatsApp. 1280×800 é um notebook comum; 390×844 é um iPhone comum.
 * Nem o maior nem o menor de cada categoria — o típico.
 */
export const VIEWPORTS_PREVIA = [
  { id: "computador", nome: "Computador", largura: 1280, altura: 800 },
  { id: "celular", nome: "Celular", largura: 390, altura: 844 },
] as const;
export type ViewportPrevia = (typeof VIEWPORTS_PREVIA)[number]["id"];

/**
 * ── CORES PRÓPRIAS (05/09/2026) ───────────────────────────────────────────
 *
 * Três temas prontos serviam a todo mundo mais ou menos e a ninguém exatamente.
 * O dono pediu cores editáveis, "inclusive dos botões".
 *
 * TRÊS cores, e não as oito variáveis do tema: fundo, texto e destaque (o botão,
 * o coração marcado, o traço do play). O resto — superfície, texto suave, texto
 * tênue, linha, texto sobre o botão — é DERIVADO dessas três em
 * `variaveisDoTema`. Oito seletores seriam oito jeitos de quebrar a
 * legibilidade; três, com derivação, mantêm a paleta coerente por construção.
 *
 * Cada uma é opcional: quem mexe só no botão fica com fundo e texto do tema.
 * Toda cor é `#rrggbb` minúsculo, e SÓ isso — ver `lerCores` para o porquê.
 */
export interface CoresProprias {
  fundo?: string;
  texto?: string;
  destaque?: string;
}

export interface Aparencia {
  capa: Capa;
  tema: Tema;
  tipografia: Tipografia;
  grade: Grade;
  densidade: Densidade;
  logo: TamanhoLogo;
  /** Ausente na maioria das galerias: só existe quando alguém escolheu uma cor. */
  cores?: CoresProprias;
}

/*
 * O PADRÃO DA LOGO É `media`, e isso MUDA a capa de quem nunca escolheu.
 *
 * Até 31/08/2026 a altura era um `max-h-14` dentro do componente — 56 px fixos,
 * o mesmo para logo quadrada e para logo horizontal fina. Como `lerAparencia`
 * completa o que falta com o padrão, toda galeria gravada antes deste eixo passa
 * a desenhar a logo em 88 px.
 *
 * É mudança de cara em galeria já existente, que é justamente o que a regra dos
 * ids de tipografia proíbe — e aqui é DE PROPÓSITO, porque o pedido do dono foi
 * "a logo tem que ser maior". Um padrão que repetisse os 56 px atenderia à letra
 * e não ao pedido: quem não mexesse em nada continuaria com a logo miúda.
 */
export const APARENCIA_PADRAO: Aparencia = {
  capa: "imersa",
  tema: "noite",
  tipografia: "serifada",
  grade: "colunas",
  densidade: "normal",
  logo: "media",
};

/** Lê o JSON do banco garantindo valores válidos — galeria antiga cai no padrão. */
export function lerAparencia(bruto: unknown): Aparencia {
  const o = (bruto ?? {}) as Partial<Aparencia>;
  const valida = <T extends string>(v: unknown, opcoes: readonly T[], padrao: T): T =>
    opcoes.includes(v as T) ? (v as T) : padrao;

  const cores = lerCores(o.cores);
  return {
    capa: valida(o.capa, OPCOES.capa.map((x) => x.id), APARENCIA_PADRAO.capa),
    tema: valida(o.tema, OPCOES.tema.map((x) => x.id), APARENCIA_PADRAO.tema),
    tipografia: valida(o.tipografia, OPCOES.tipografia.map((x) => x.id), APARENCIA_PADRAO.tipografia),
    grade: valida(o.grade, OPCOES.grade.map((x) => x.id), APARENCIA_PADRAO.grade),
    densidade: valida(o.densidade, OPCOES.densidade.map((x) => x.id), APARENCIA_PADRAO.densidade),
    logo: valida(o.logo, OPCOES.logo.map((x) => x.id), APARENCIA_PADRAO.logo),
    /* Só entra quando sobrou alguma cor válida. Galeria sem cor própria não
       ganha um `cores: {}` — é o que mantém `presetEquivalente` e a comparação
       "sujo/publicado" do editor iguais ao que eram. */
    ...(cores ? { cores } : {}),
  };
}

/**
 * As cores próprias, ou nada.
 *
 * ── SEGURANÇA, E NÃO CAPRICHO ─────────────────────────────────────────────
 * Estes valores vão parar num `style` em linha, como variáveis CSS, na galeria
 * que o CLIENTE do fotógrafo abre. `"#fff; background:url(x)"` dentro de um
 * style é CSS injetado. Por isso a regra é a mais burra possível: seis
 * hexadecimais depois de `#`, e mais nada. Não se corrige, não se apara, não se
 * aceita `#fff` nem `rgb()` — o que não casar é descartado, como todo eixo de
 * `lerAparencia` descarta o que não está na lista.
 *
 * `<input type="color">` sempre emite `#rrggbb` minúsculo, então a regra não
 * custa nada para quem usa a tela; custa só para quem tenta passar por fora.
 */
const COR_HEX = /^#[0-9a-f]{6}$/;

function lerCores(bruto: unknown): CoresProprias | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const cores: CoresProprias = {};
  for (const chave of ["fundo", "texto", "destaque"] as const) {
    const v = o[chave];
    if (typeof v !== "string") continue;
    const t = v.toLowerCase();
    if (COR_HEX.test(t)) cores[chave] = t;
  }
  return Object.keys(cores).length ? cores : null;
}

/**
 * Altura máxima da logo na capa, em pixels.
 *
 * Máxima, e não fixa: a largura acompanha (`w-auto`) e o `object-contain` cabe a
 * imagem dentro. Logo horizontal fina chega no teto de altura sem esticar; logo
 * quadrada usa o teto inteiro. Um número só serve para as duas porque quem
 * limita é a ALTURA, que é o que aperta contra o título logo abaixo.
 */
export const alturaLogoPx = (t: TamanhoLogo): number =>
  OPCOES.logo.find((o) => o.id === t)?.px ?? OPCOES.logo[1].px;

// --- eixos, com rótulos para a interface --------------------------------------

export const OPCOES = {
  capa: [
    { id: "imersa", nome: "Imersa", desc: "Foto em tela cheia com o título por cima" },
    { id: "jornal", nome: "Jornal", desc: "Fundo limpo, tipografia grande, botão de entrada" },
    { id: "dividida", nome: "Dividida", desc: "Foto de um lado, texto do outro" },
    { id: "minima", nome: "Mínima", desc: "Só tipografia, sem foto de capa" },
    { id: "convite", nome: "Convite", desc: "Foto emoldurada, título no pé e botão de entrada" },
  ],
  tema: [
    { id: "noite", nome: "Noite", desc: "Fundo escuro — as fotos brilham" },
    { id: "claro", nome: "Claro", desc: "Fundo branco, ar de revista" },
    { id: "creme", nome: "Creme", desc: "Tons terrosos, clima quente" },
  ],
  /*
   * ── DE CATEGORIA PARA FONTE (26/08/2026) ────────────────────────────────
   * Antes eram três categorias — "Serifada", "Moderna", "Manuscrita" — e o
   * fotógrafo não escolhia a fonte, escolhia um adjetivo. Agora a lista tem
   * nome de fonte, agrupada por família para continuar navegável.
   *
   * Os três ids ORIGINAIS ficam, apontando para as mesmas fontes de sempre.
   * Eles estão gravados em galerias já ENTREGUES: mudar o que `serifada`
   * significa trocaria a cara da galeria de um casal sem ninguém tocar nela.
   * `scripts/testar-aparencia.mjs` prende isso.
   */
  tipografia: [
    { id: "serifada", nome: "Cormorant", desc: "Serifada · clássica e fina", familia: "Serifadas" },
    { id: "playfair", nome: "Playfair", desc: "Serifada · contraste alto", familia: "Serifadas" },
    { id: "lora", nome: "Lora", desc: "Serifada · encorpada, boa em texto", familia: "Serifadas" },
    { id: "moderna", nome: "Montserrat", desc: "Sem serifa · geométrica", familia: "Sem serifa" },
    { id: "jost", nome: "Jost", desc: "Sem serifa · seca e moderna", familia: "Sem serifa" },
    { id: "raleway", nome: "Raleway", desc: "Sem serifa · leve e arejada", familia: "Sem serifa" },
    { id: "manuscrita", nome: "Great Vibes", desc: "Manuscrita · assinatura", familia: "Manuscritas" },
    { id: "parisienne", nome: "Parisienne", desc: "Manuscrita · convite", familia: "Manuscritas" },
    { id: "petit", nome: "Petit Formal", desc: "Manuscrita · formal e legível", familia: "Manuscritas" },
    { id: "garamond", nome: "EB Garamond", desc: "Serifada · quente e clássica", familia: "Serifadas" },
    { id: "baskerville", nome: "Baskerville", desc: "Serifada · editorial, muito legível", familia: "Serifadas" },
    { id: "bodoni", nome: "Bodoni", desc: "Serifada · contraste extremo, ar de moda", familia: "Serifadas" },
    { id: "josefin", nome: "Josefin Sans", desc: "Sem serifa · art déco, delicada", familia: "Sem serifa" },
    { id: "work", nome: "Work Sans", desc: "Sem serifa · neutra e sólida", familia: "Sem serifa" },
    { id: "outfit", nome: "Outfit", desc: "Sem serifa · geométrica e atual", familia: "Sem serifa" },
    { id: "dancing", nome: "Dancing Script", desc: "Manuscrita · solta e alegre", familia: "Manuscritas" },
    { id: "sacramento", nome: "Sacramento", desc: "Manuscrita · fina e discreta", familia: "Manuscritas" },
    { id: "italianno", nome: "Italianno", desc: "Manuscrita · caligrafia de convite", familia: "Manuscritas" },
    /* MAIÚSCULAS é família nova: a tipografia que o fotógrafo reconhece do papel
     * do convite, e que não cabia em nenhuma das três anteriores. */
    { id: "cinzel", nome: "Cinzel", desc: "Maiúsculas · romana, de convite", familia: "Maiúsculas" },
    { id: "marcellus", nome: "Marcellus", desc: "Maiúsculas · clássica e serena", familia: "Maiúsculas" },
    { id: "tenor", nome: "Tenor Sans", desc: "Maiúsculas · limpa e espaçada", familia: "Maiúsculas" },
    /* Só aparece para quem enviou uma fonte — o editor filtra pela família. Fica
     * na lista mesmo assim porque  precisa aceitá-la ao ler uma
     * galeria já gravada, inclusive depois de a fonte ter sido removida. */
    { id: "propria", nome: "A minha fonte", desc: "O arquivo que você enviou em Conta", familia: "Sua fonte" },
  ],
  grade: [
    { id: "colunas", nome: "Colunas", desc: "Alturas variadas, estilo mural" },
    { id: "linhas", nome: "Linhas", desc: "Fileiras alinhadas, sem cortar foto" },
    { id: "quadrada", nome: "Quadrada", desc: "Tudo no mesmo tamanho" },
    { id: "editorial", nome: "Editorial", desc: "Destaques maiores intercalados" },
  ],
  densidade: [
    { id: "compacta", nome: "Compacta", desc: "Mais fotos por tela" },
    { id: "normal", nome: "Normal", desc: "Equilibrada" },
    { id: "arejada", nome: "Arejada", desc: "Espaço para respirar" },
  ],
  /*
   * O `px` é a altura MÁXIMA na capa, e é a fonte única desse número: o
   * componente lê daqui em vez de trazer a própria tabela. `testar-aparencia`
   * confere que a escada sobe e que a capa não tem altura escrita à mão.
   *
   * O teto é 200 px porque acima disso a logo passa a disputar a tela com o
   * título do casal na capa imersa — deixa de ser marca e vira cabeçalho.
   */
  logo: [
    { id: "discreta", nome: "Discreta", desc: "Assinatura no canto", px: 56 },
    { id: "media", nome: "Média", desc: "Marca visível, sem roubar o título", px: 88 },
    { id: "grande", nome: "Grande", desc: "A marca conduz a capa", px: 136 },
    { id: "enorme", nome: "Enorme", desc: "Logo em primeiro plano", px: 200 },
  ],
} as const;

// --- presets ------------------------------------------------------------------

export interface Preset {
  id: string;
  nome: string;
  desc: string;
  aparencia: Aparencia;
}

export const PRESETS: Preset[] = [
  {
    /* O estilo da casa. O id NAO e gravado no banco — `galerias.aparencia`
     * guarda os cinco eixos, e `presetEquivalente` deduz o preset a partir
     * deles. Por isso renomear aqui nao orfana galeria nenhuma. */
    id: "atomo",
    nome: "Átomo",
    desc: "Escura e cinematográfica. A foto é a única fonte de luz.",
    aparencia: { capa: "imersa", tema: "noite", tipografia: "serifada", grade: "editorial", densidade: "normal", logo: "media" },
  },
  {
    id: "revista",
    nome: "Revista",
    desc: "Fundo claro, tipografia grande, mural de colunas.",
    aparencia: { capa: "jornal", tema: "claro", tipografia: "serifada", grade: "colunas", densidade: "normal", logo: "media" },
  },
  {
    id: "atelie",
    nome: "Ateliê",
    desc: "Tons terrosos e manuscrita. Clima de convite de casamento.",
    aparencia: { capa: "dividida", tema: "creme", tipografia: "manuscrita", grade: "linhas", densidade: "arejada", logo: "media" },
  },
  {
    id: "essencial",
    nome: "Essencial",
    desc: "Sem firula: entra direto nas fotos, tudo do mesmo tamanho.",
    aparencia: { capa: "minima", tema: "claro", tipografia: "moderna", grade: "quadrada", densidade: "compacta", logo: "media" },
  },
  {
    /*
     * Pedido da Carol em 31/08/2026, a partir de uma galeria de casamento que
     * ela viu no Pixieset. As peças que fazem aquela cara, e por quê:
     *
     *   capa convite  — foto emoldurada, título e botão no pé
     *   tema claro    — papel branco; o destaque vira o preto do botão
     *   Bodoni        — serifada de contraste extremo, a letra de convite
     *   grade linhas  — fileiras alinhadas, sem cortar foto
     *   compacta      — as fotos quase se encostando, como um contato impresso
     *   logo discreta — a marca assina no alto, não disputa com o título
     */
    id: "convite",
    nome: "Convite",
    desc: "Papel branco, serifada de convite e fotos coladas. A capa chama para entrar.",
    aparencia: { capa: "convite", tema: "claro", tipografia: "bodoni", grade: "linhas", densidade: "compacta", logo: "discreta" },
  },
  /*
   * ── A SEGUNDA LEVA (27/08/2026) ─────────────────────────────────────────
   *
   * Quatro presets eram pouco para o que eles fazem: preset é o atalho de quem
   * NÃO quer abrir o ajuste fino, e com quatro a chance de nenhum servir é alta
   * — aí a pessoa abre os cinco eixos e monta na mão, que é exatamente o
   * trabalho que o preset existe para poupar.
   *
   * Os quatro novos não são variações de cor dos antigos: cada um combina capa,
   * grade e densidade diferentes, e usa a família de fonte que os primeiros não
   * alcançavam. Preset que muda só o tema seria uma quinta pastilha sem quinta
   * decisão.
   */
  {
    id: "convite",
    nome: "Convite",
    desc: "Caligrafia sobre creme, fotos em fileiras. Clima de papel timbrado.",
    aparencia: { capa: "dividida", tema: "creme", tipografia: "italianno", grade: "linhas", densidade: "arejada", logo: "media" },
  },
  {
    id: "moda",
    nome: "Moda",
    desc: "Contraste alto e destaques grandes, como editorial de revista.",
    aparencia: { capa: "jornal", tema: "claro", tipografia: "bodoni", grade: "editorial", densidade: "normal", logo: "media" },
  },
  {
    id: "cerimonia",
    nome: "Cerimônia",
    desc: "Maiúsculas romanas sobre fundo escuro. Solene, sem ser pesada.",
    aparencia: { capa: "imersa", tema: "noite", tipografia: "cinzel", grade: "colunas", densidade: "normal", logo: "media" },
  },
  {
    id: "papel",
    nome: "Papel",
    desc: "Branco, ar déco e muito espaço. As fotos respiram.",
    aparencia: { capa: "minima", tema: "claro", tipografia: "josefin", grade: "colunas", densidade: "arejada", logo: "media" },
  },
];

export const presetPorId = (id: string) => PRESETS.find((p) => p.id === id);

/** Qual preset corresponde à aparência atual (para marcar o card selecionado). */
/*
 * TODOS os eixos entram na comparação, `logo` inclusive.
 *
 * Ele ficou de fora quando nasceu, e o efeito era o editor marcar "Convite"
 * numa galeria em que a pessoa tinha aumentado a logo — dizendo que ela estava
 * num preset em que não estava. Marcação que mente é pior que marcação nenhuma:
 * quem confia nela deixa de olhar o resto.
 *
 * Com o eixo dentro, quem mexeu num detalhe vê "personalizado", que é a
 * verdade — e o editor abre o ajuste fino sozinho nesse caso, para a escolha
 * atual continuar visível em vez de virar oito botões apagados.
 */
export function presetEquivalente(a: Aparencia): string | null {
  /* Cor própria tira a galeria de qualquer preset: "no ar: Átomo" com o botão
     rosa seria a tela descrevendo uma galeria que não existe. */
  if (a.cores && Object.keys(a.cores).length > 0) return null;
  const igual = (x: Aparencia, y: Aparencia) =>
    x.capa === y.capa && x.tema === y.tema && x.tipografia === y.tipografia &&
    x.grade === y.grade && x.densidade === y.densidade && x.logo === y.logo;
  return PRESETS.find((p) => igual(p.aparencia, a))?.id ?? null;
}

// --- tradução para CSS --------------------------------------------------------

/** Cada tema é um conjunto de variáveis; os componentes leem sempre as mesmas. */
export const TEMAS: Record<Tema, Record<string, string>> = {
  /*
   * NOITE — a sala de projeção, mesma paleta do painel.
   *
   * Preto azulado de propósito: num fundo quente, pele de retrato fica lavada,
   * porque fundo e pele disputam a mesma faixa de cor. Frio, a foto salta.
   * O destaque é âmbar e aparece só em ação (botão, coração marcado).
   */
  noite: {
    "--g-fundo": "#07080b",
    "--g-superficie": "#101319",
    "--g-texto": "#eef1f6",
    "--g-suave": "#a4adbd",
    "--g-tenue": "#6b7484",
    "--g-linha": "rgba(190,205,230,.16)",
    "--g-destaque": "#d9a441",
    "--g-sobre-destaque": "#0a0906",
  },
  claro: {
    "--g-fundo": "#ffffff",
    "--g-superficie": "#f6f4ef",
    "--g-texto": "#211d16",
    "--g-suave": "#5d574b",
    "--g-tenue": "#938b7c",
    "--g-linha": "rgba(33,29,22,.14)",
    "--g-destaque": "#211d16",
    "--g-sobre-destaque": "#ffffff",
  },
  creme: {
    "--g-fundo": "#f7f1e6",
    "--g-superficie": "#ede2cd",
    "--g-texto": "#43382a",
    "--g-suave": "#77694f",
    "--g-tenue": "#a3947c",
    "--g-linha": "rgba(67,56,42,.16)",
    "--g-destaque": "#8c6f3f",
    "--g-sobre-destaque": "#f9f4ea",
  },
};

// --- cores próprias por cima do tema ------------------------------------------

/*
 * Aritmética de cor em hexadecimal puro, sem `color-mix()`.
 *
 * Poderia ser CSS: `color-mix(in srgb, var(--g-fundo) 94%, var(--g-texto))`
 * faria a superfície sozinho no navegador. Não é, por dois motivos. O primeiro
 * é medir: `testar-cores-galeria.mjs` confere o contraste do texto sobre o botão
 * contra um piso, e não dá para medir contraste de uma expressão que só o
 * navegador resolve. O segundo é o e-mail: a capa da galeria vai num cartão
 * para o WhatsApp e num e-mail, e cliente de e-mail não conhece color-mix.
 * Número concreto serve nos dois lugares; expressão serve num só.
 */
const hexParaRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const rgbParaHex = (r: number, g: number, b: number): string =>
  "#" + [r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("");

/** `t` de `a`: 0 devolve `a`, 1 devolve `b`. */
function misturar(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexParaRgb(a);
  const [r2, g2, b2] = hexParaRgb(b);
  return rgbParaHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/** Luminância relativa (WCAG 2), a mesma conta de `lib/marca-estudio.ts`. */
function luminancia(hex: string): number {
  const [r, g, b] = hexParaRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * As variáveis CSS da galeria: o tema, com as cores próprias por cima.
 *
 * Sem `cores`, devolve EXATAMENTE `TEMAS[tema]` — toda galeria de antes de
 * 05/09/2026 continua idêntica ao pixel. Com cores, as três escolhidas entram
 * no lugar das do tema, e as derivadas são refeitas a partir delas:
 *
 *   superfície  fundo puxado 6% para o texto — o cartão que "sobe" do fundo
 *   suave       texto puxado 25% para o fundo — o secundário, ainda ≥ 4,5:1
 *   tênue       texto puxado 40% para o fundo — rótulo miúdo, ≥ 3:1
 *
 * Os dois números foram medidos, não escolhidos: a 30% o suave caía a 4,34:1
 * no par creme (fundo #f7f1e6, texto #43382a), abaixo do piso; a 25% o pior
 * par dá 5,00:1. A 50% o tênue caía a 2,64:1; a 40% dá 3,37:1 — melhor que os
 * 2,64:1 do tênue do próprio tema creme, feito à mão.
 *   linha       o texto a 16% de opacidade — divisória que não grita
 *   sobre-destaque  preto ou branco, o que contrastar mais com o botão
 *
 * A única promessa medida é a última: o texto do botão passa de 4,5:1 para
 * QUALQUER cor de botão — cinza médio é o pior caso e ainda passa. Fundo e
 * texto são escolha da pessoa; se ela pôr cinza sobre cinza, a galeria vai
 * ficar cinza sobre cinza, e a prévia vai mostrar isso antes de publicar.
 */
export function variaveisDoTema(a: Aparencia): Record<string, string> {
  const base = TEMAS[a.tema];
  const c = a.cores;
  if (!c || Object.keys(c).length === 0) return base;

  const fundo = c.fundo ?? base["--g-fundo"];
  const texto = c.texto ?? base["--g-texto"];
  const destaque = c.destaque ?? base["--g-destaque"];
  const [tr, tg, tb] = hexParaRgb(texto);

  /* Preto ou branco: o que der mais contraste. `contraste()` de marca-estudio
     é (L1+0,05)/(L2+0,05); aqui basta comparar as duas luminâncias contra a do
     botão, que é a mesma decisão sem importar o módulo do servidor. */
  const L = luminancia(destaque);
  const sobreDestaque = (1.05) / (L + 0.05) >= (L + 0.05) / 0.05 ? "#ffffff" : "#000000";

  return {
    "--g-fundo": fundo,
    "--g-superficie": misturar(fundo, texto, 0.06),
    "--g-texto": texto,
    "--g-suave": misturar(texto, fundo, 0.25),
    "--g-tenue": misturar(texto, fundo, 0.4),
    "--g-linha": `rgba(${tr},${tg},${tb},.16)`,
    "--g-destaque": destaque,
    "--g-sobre-destaque": sobreDestaque,
  };
}

/**
 * Aponta para as variáveis que o next/font define no <body> — e NÃO para os
 * tokens do Tailwind (--font-serif e afins). O `@theme inline` embute os valores
 * nas classes utilitárias em vez de publicar a variável no :root, então
 * `var(--font-serif)` não existe em tempo de execução e o título cairia na fonte
 * padrão do sistema.
 */
/*
 * Cada fonte com uma PILHA de reserva de verdade, não só o nome.
 *
 * Se o woff2 não chegar — rede ruim no celular do convidado, bloqueador —, o
 * título cai no reserva. Um reserva da mesma família mantém a página parecida
 * com o que o fotógrafo escolheu; sem ele, cai em Times e a entrega inteira
 * muda de tom no pior momento possível.
 *
 * As três primeiras variáveis são as antigas (`serif-app`, `sans-app`,
 * `script-app`) e não podem ser renomeadas: os ids que as usam estão gravados
 * em galerias entregues.
 */
export const FONTES_TITULO: Record<Tipografia, string> = {
  /* Não é uma fonte nossa: o nome da família é declarado pelo @font-face que a
     galeria injeta quando o estúdio tem arquivo enviado. Sem esse @font-face
     (fonte removida, ou estúdio que nunca enviou), o navegador cai na serifada
     do fim da lista — que é o comportamento certo, e não um erro a tratar. */
  propria: '"FonteDoEstudio", var(--font-serif-app), Georgia, serif',
  serifada: 'var(--font-serif-app), "Iowan Old Style", Palatino, Georgia, serif',
  playfair: 'var(--font-titulo-playfair), "Times New Roman", Georgia, serif',
  lora: 'var(--font-titulo-lora), Georgia, "Times New Roman", serif',
  moderna: 'var(--font-sans-app), system-ui, "Segoe UI", sans-serif',
  jost: 'var(--font-titulo-jost), "Futura", "Century Gothic", system-ui, sans-serif',
  raleway: 'var(--font-titulo-raleway), "Segoe UI", system-ui, sans-serif',
  manuscrita: 'var(--font-script-app), "Segoe Script", cursive',
  parisienne: 'var(--font-titulo-parisienne), "Segoe Script", cursive',
  petit: 'var(--font-titulo-petit), "Segoe Script", cursive',
  garamond: 'var(--font-titulo-garamond), Garamond, Georgia, serif',
  baskerville: 'var(--font-titulo-baskerville), Baskerville, Georgia, serif',
  bodoni: 'var(--font-titulo-bodoni), "Bodoni MT", Didot, Georgia, serif',
  josefin: 'var(--font-titulo-josefin), "Century Gothic", system-ui, sans-serif',
  work: 'var(--font-titulo-work), "Segoe UI", system-ui, sans-serif',
  outfit: 'var(--font-titulo-outfit), "Segoe UI", system-ui, sans-serif',
  dancing: 'var(--font-titulo-dancing), "Segoe Script", cursive',
  sacramento: 'var(--font-titulo-sacramento), "Segoe Script", cursive',
  italianno: 'var(--font-titulo-italianno), "Segoe Script", cursive',
  cinzel: 'var(--font-titulo-cinzel), "Trajan Pro", Georgia, serif',
  marcellus: 'var(--font-titulo-marcellus), Georgia, serif',
  tenor: 'var(--font-titulo-tenor), "Optima", "Segoe UI", sans-serif',
};

/** Espaçamento entre as fotos e quantas cabem por linha. */
export const DENSIDADES: Record<Densidade, { gap: string; colunas: number }> = {
  compacta: { gap: "0.25rem", colunas: 5 },
  normal: { gap: "0.5rem", colunas: 4 },
  arejada: { gap: "1.25rem", colunas: 3 },
};
