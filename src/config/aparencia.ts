/**
 * Aparência da galeria: eixos independentes + presets.
 *
 * Por que eixos em vez de "temas prontos": um template fechado sempre erra para
 * alguém — o Sirius quer capa clara com tipografia grande, a Carol quer creme e
 * serifada, o próximo vai querer outra coisa. Combinando eixos, saem dezenas de
 * resultados sem escrever um template para cada. Os presets existem para quem
 * não quer escolher: um clique e está pronto, e ainda dá para ajustar depois.
 */

export type Capa = "imersa" | "jornal" | "dividida" | "minima";
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
  | "tenor";
export type Grade = "colunas" | "linhas" | "quadrada" | "editorial";
export type Densidade = "compacta" | "normal" | "arejada";

export type TamanhoLogo = "discreta" | "media" | "grande" | "enorme";

export interface Aparencia {
  capa: Capa;
  tema: Tema;
  tipografia: Tipografia;
  grade: Grade;
  densidade: Densidade;
  logo: TamanhoLogo;
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

  return {
    capa: valida(o.capa, OPCOES.capa.map((x) => x.id), APARENCIA_PADRAO.capa),
    tema: valida(o.tema, OPCOES.tema.map((x) => x.id), APARENCIA_PADRAO.tema),
    tipografia: valida(o.tipografia, OPCOES.tipografia.map((x) => x.id), APARENCIA_PADRAO.tipografia),
    grade: valida(o.grade, OPCOES.grade.map((x) => x.id), APARENCIA_PADRAO.grade),
    densidade: valida(o.densidade, OPCOES.densidade.map((x) => x.id), APARENCIA_PADRAO.densidade),
    logo: valida(o.logo, OPCOES.logo.map((x) => x.id), APARENCIA_PADRAO.logo),
  };
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
export function presetEquivalente(a: Aparencia): string | null {
  const igual = (x: Aparencia, y: Aparencia) =>
    x.capa === y.capa && x.tema === y.tema && x.tipografia === y.tipografia &&
    x.grade === y.grade && x.densidade === y.densidade;
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
