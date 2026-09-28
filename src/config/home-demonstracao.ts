import { lerAparencia, type Aparencia } from "@/config/aparencia";

/**
 * AS GALERIAS DE DEMONSTRAÇÃO DA HOME — fotos e identidades.
 *
 * ── O QUE ESTÁ AQUI É DE VERDADE ──────────────────────────────────────────
 *
 * Cada identidade abaixo é uma `Aparencia` que o editor de Design produz:
 * mesmas capas, mesmas fontes, mesmos temas, mesmas grades, desenhadas pelos
 * mesmos componentes que o cliente vê (`GaleriaCapa`, `GaleriaGrade`). A home
 * não tem um desenho próprio de "galeria de mentira" — se o produto mudar, a
 * vitrine muda junto.
 *
 * ── UMA GALERIA, UM CASAMENTO (28/09/2026) ────────────────────────────────
 *
 * As primeiras fotos autorais chegaram espalhadas pelas quatro galerias de
 * exemplo, e o mesmo casal aparecia como "Marina & Caio" numa e "Ana & Pedro"
 * na outra. Felipe: "todas as fotos que mandei são de uma galeria só" — a da
 * Vanessa & Kalil, fotografada pela Carol. Desde então CADA GALERIA TEM AS
 * SUAS FOTOS: a Vanessa & Kalil, as do casamento dela; as outras, as
 * provisórias do começo (Unsplash, licença livre), até chegarem galerias de
 * verdade — a do Juan vem para o lugar da Ana & Pedro.
 *
 * ── AS FOTOS MUDAM PELO ADMIN ─────────────────────────────────────────────
 *
 * Cada foto é um LUGAR — `<galeria>-<n>` (`delicada-1`, `editorial-4`…) e o
 * `respiro`, a foto grande perto do fim — com uma foto PADRÃO aqui, no
 * repositório. O admin troca a foto de um lugar (`/painel/admin/home`), e a
 * troca vale por cima do padrão até alguém voltar ao padrão. Quem junta as
 * duas coisas é `lib/fotos-da-home.ts`. O lugar 1 de cada galeria é a capa.
 *
 * ── OS NOMES ──────────────────────────────────────────────────────────────
 *
 * Nenhuma galeria leva nome de estúdio: todas assinam "Seu Estúdio" — a frase
 * que a seção quer que o visitante escute é "isto pode ser o SEU". A Vanessa &
 * Kalil é um casamento de verdade, com o nome, a data e o lugar que o Felipe
 * passou; as outras são inventadas, como sempre foram.
 */

export type Curadoria = "A" | "B" | "C" | "D" | "E";

export interface FotoDemo {
  src: string;
  /**
   * Versão menor para a grade. Só existe na foto trocada pelo admin, que sobe
   * em dois tamanhos; os padrões já são leves e servem aos dois usos.
   */
  miniatura?: string;
  largura: number;
  altura: number;
  /** O grupo da curadoria do briefing (§24). A foto do admin não tem. */
  curadoria?: Curadoria;
  /** O que a foto mostra — para o `alt` e para quem for trocá-la. */
  descricao: string;
  /**
   * Onde a CAPA centraliza o recorte, em % da largura e da altura. A capa
   * larga corta a foto vertical, e o centro geométrico costuma cair no
   * peito das pessoas, não no rosto.
   */
  focoX: number;
  focoY: number;
}

/*
 * O ACERVO — cada arquivo uma vez só, e as galerias escolhem dele.
 *
 * Vanessa & Kalil: WebP de 1500 px (2000 no gramado, que é a foto grande do
 * fim), qualidade 76 — acima das provisórias porque a granulação some a 72.
 * Provisórias: 1100 px, qualidade 72. As medidas são as do arquivo: a grade
 * monta as fileiras pela proporção antes de a foto chegar, e
 * `testar-fotos-da-home` confere uma por uma.
 */
const ACERVO = {
  // Vanessa & Kalil — 1º de maio de 2026, Porto Alegre. Fotos da Carol.
  guardaChuva: { src: "/home/demo/guarda-chuva.webp", largura: 1000, altura: 1500, curadoria: "D", descricao: "Noivos caminhando pelo jardim debaixo de um guarda-chuva branco", focoX: 45, focoY: 58 },
  ternoMarrom: { src: "/home/demo/terno-marrom.webp", largura: 1000, altura: 1500, curadoria: "B", descricao: "Noivos de mãos dadas, terno marrom e vestido tomara que caia", focoX: 50, focoY: 45 },
  convidadosChuva: { src: "/home/demo/convidados-chuva.webp", largura: 1000, altura: 1500, curadoria: "C", descricao: "Casal de convidados abraçado na cerimônia, debaixo de chuva", focoX: 45, focoY: 38 },
  noivaMesa: { src: "/home/demo/noiva-mesa-pb.webp", largura: 1000, altura: 1500, curadoria: "C", descricao: "A noiva sorrindo à mesa do jantar, em preto e branco", focoX: 50, focoY: 35 },
  caminhada: { src: "/home/demo/caminhada-grama.webp", largura: 2000, altura: 1333, curadoria: "B", descricao: "Os noivos caminhando pelo gramado, vistos da cintura para baixo", focoX: 50, focoY: 50 },
  // Provisórias (Unsplash, licença livre).
  cadeiras: { src: "/home/demo/cerimonia-arco.webp", largura: 1100, altura: 734, curadoria: "D", descricao: "Duas cadeiras de cerimônia no gramado", focoX: 50, focoY: 50 },
  baloes: { src: "/home/demo/festa-mesa.webp", largura: 1100, altura: 734, curadoria: "A", descricao: "Casal soltando balões vermelhos com os convidados", focoX: 50, focoY: 50 },
  contraluz: { src: "/home/demo/hero-casamento.webp", largura: 1100, altura: 733, curadoria: "D", descricao: "Casal em contraluz segurando o buquê", focoX: 50, focoY: 50 },
  maos: { src: "/home/demo/madrinhas.webp", largura: 1100, altura: 733, curadoria: "B", descricao: "Mãos dadas e a sombra do casal na grama", focoX: 50, focoY: 50 },
  alianca: { src: "/home/demo/maos-alianca.webp", largura: 1100, altura: 733, curadoria: "C", descricao: "Mãos com a aliança sobre o buquê", focoX: 50, focoY: 50 },
  palmeira: { src: "/home/demo/noiva-retrato.webp", largura: 760, altura: 1140, curadoria: "C", descricao: "Casal rindo embaixo de uma palmeira", focoX: 50, focoY: 50 },
  confete: { src: "/home/demo/noivos-beijo.webp", largura: 760, altura: 1140, curadoria: "A", descricao: "Beijo entre confetes e madrinhas de azul", focoX: 50, focoY: 50 },
  praia: { src: "/home/demo/vestido.webp", largura: 760, altura: 1140, curadoria: "B", descricao: "Casal na praia com o véu ao vento", focoX: 50, focoY: 50 },
} as const satisfies Record<string, FotoDemo>;

export const GALERIAS_DA_HOME = ["delicada", "editorial", "classica", "noite"] as const;
export type IdGaleria = (typeof GALERIAS_DA_HOME)[number];

/**
 * As fotos padrão de cada galeria, NA ORDEM DOS LUGARES: a primeira é a capa
 * (lugar 1), e a grade mostra todas.
 */
const FOTOS_DAS_GALERIAS: Record<IdGaleria, readonly FotoDemo[]> = {
  delicada: [ACERVO.guardaChuva, ACERVO.ternoMarrom, ACERVO.convidadosChuva, ACERVO.noivaMesa, ACERVO.caminhada],
  editorial: [ACERVO.praia, ACERVO.maos, ACERVO.alianca, ACERVO.palmeira, ACERVO.contraluz, ACERVO.cadeiras, ACERVO.confete, ACERVO.baloes],
  classica: [ACERVO.contraluz, ACERVO.palmeira, ACERVO.alianca, ACERVO.cadeiras, ACERVO.praia, ACERVO.confete, ACERVO.maos, ACERVO.baloes],
  noite: [ACERVO.maos, ACERVO.contraluz, ACERVO.palmeira, ACERVO.cadeiras, ACERVO.confete, ACERVO.alianca, ACERVO.praia, ACERVO.baloes],
};

/** Um lugar de galeria: `delicada-1`, `noite-8`… O 1 é a capa. */
export type IdFoto = `${IdGaleria}-${number}`;
export type LugarDaHome = IdFoto | "respiro";
export type FotosDaHome = Record<LugarDaHome, FotoDemo>;

/** Os lugares de uma galeria, na ordem: o primeiro é a capa. */
export function lugaresDaGaleria(galeria: IdGaleria): IdFoto[] {
  return FOTOS_DAS_GALERIAS[galeria].map((_, i) => `${galeria}-${i + 1}` as IdFoto);
}

export const LUGARES_DA_HOME: LugarDaHome[] = [
  ...GALERIAS_DA_HOME.flatMap(lugaresDaGaleria),
  "respiro",
];

const CONJUNTO_DE_LUGARES = new Set<string>(LUGARES_DA_HOME);

export function ehLugarDaHome(v: unknown): v is LugarDaHome {
  return typeof v === "string" && CONJUNTO_DE_LUGARES.has(v);
}

export const FOTOS_PADRAO: FotosDaHome = Object.fromEntries([
  ...GALERIAS_DA_HOME.flatMap((g) =>
    FOTOS_DAS_GALERIAS[g].map((f, i) => [`${g}-${i + 1}`, { ...f }] as const),
  ),
  ["respiro", { ...ACERVO.caminhada }],
]) as FotosDaHome;

export interface Identidade {
  id: IdGaleria;
  /** Como a seção de exemplos chama o jeito de fotografar — não é nome de preset. */
  rotulo: string;
  titulo: string;
  /** O fim do endereço na barra do navegador desenhado em volta da galeria. */
  slug: string;
  data: string;
  /** A mesma data, para o banco — o script dos prints cria a galeria com ela. */
  dataEvento: string;
  local: string;
  capa: IdFoto;
  fotos: IdFoto[];
  aparencia: Aparencia;
  /**
   * Tratamento de PLACEHOLDER. A galeria editorial precisa ler como outro
   * fotógrafo, e com as mesmas fotos coloridas das outras não leria; em preto
   * e branco lê. Não é recurso do produto, e a página não diz que é.
   */
  pretoEBranco?: boolean;
}

/** A grade mostra a capa por último: a galeria abre com ela lá em cima. */
function fotosDaGrade(galeria: IdGaleria): IdFoto[] {
  const [capa, ...resto] = lugaresDaGaleria(galeria);
  return [...resto, capa];
}

export const IDENTIDADES: Identidade[] = [
  {
    /*
     * ── VANESSA & KALIL (28/09/2026) ──────────────────────────────────────
     *
     * Um casamento de verdade, fotografado pela Carol — 1º de maio de 2026,
     * Porto Alegre —, no lugar da "Marina & Caio" inventada. O desenho é o
     * das galerias que a Carol entrega (o modelo "Convite", pedido dela em
     * 31/08/2026): papel branco, a foto emoldurada, o nome numa serifada de
     * convite e o "ver galeria" no pé. É esta galeria que aparece no celular
     * da home, na seleção, no cofre e nos prints do painel
     * (`GALERIA_EM_DESTAQUE`).
     */
    id: "delicada",
    rotulo: "Clara e delicada",
    titulo: "Vanessa & Kalil",
    slug: "vanessa-e-kalil",
    data: "1º de maio de 2026",
    dataEvento: "2026-05-01",
    local: "Porto Alegre",
    capa: "delicada-1",
    fotos: fotosDaGrade("delicada"),
    aparencia: lerAparencia({
      capa: "convite",
      tema: "claro",
      tipografia: "bodoni",
      peso: "leve",
      grade: "colunas",
      densidade: "compacta",
      logo: "discreta",
      canto: "suave",
      alinhamento: "centro",
      alturaCapa: "cheia",
    }),
  },
  {
    id: "editorial",
    rotulo: "Editorial e sóbria",
    titulo: "Helena e Rafael",
    slug: "helena-e-rafael",
    data: "Março de 2026",
    dataEvento: "2026-03-14",
    local: "São Paulo",
    capa: "editorial-1",
    fotos: fotosDaGrade("editorial"),
    pretoEBranco: true,
    aparencia: lerAparencia({
      capa: "dividida",
      tema: "claro",
      cores: { fundo: "#ffffff", texto: "#111111", destaque: "#111111" },
      tipografia: "bodoni",
      peso: "leve",
      grade: "quadrada",
      densidade: "arejada",
      canto: "reto",
      alinhamento: "esquerda",
      alturaCapa: "media",
      fonteDetalhe: "texto",
    }),
  },
  {
    /*
     * ── NO DESENHO DE QUEM FOTOGRAFA HOJE (28/09/2026) ─────────────────────
     *
     * Era capa convite, creme e letra cursiva (Great Vibes). Felipe: "como
     * Carol e Juan são fotógrafos atuais, eles querem algo mais parecido com
     * o estilo deles". A cursiva sobre creme é justamente o código de
     * "casamento premium" que a estratégia de marca pede para evitar (§12).
     *
     * O desenho é o das galerias do Juan: a capa jornal ("a referência do
     * Sirius" em `galeria-capa.tsx`) — fundo claro, a etiqueta "Casamento"
     * em cima, o nome grande numa serifada forte e a foto grande logo
     * abaixo —, e a grade "Colunas", a que ele usa nas entregas.
     *
     * O lugar é da galeria do Juan, que ele vai mandar: até lá, as fotos são
     * as provisórias.
     */
    id: "classica",
    rotulo: "Natural e contemporânea",
    titulo: "Ana & Pedro",
    slug: "ana-e-pedro",
    data: "21 de março de 2026",
    dataEvento: "2026-03-21",
    local: "Serra Gaúcha",
    capa: "classica-1",
    fotos: fotosDaGrade("classica"),
    aparencia: lerAparencia({
      capa: "jornal",
      tema: "claro",
      tipografia: "playfair",
      peso: "forte",
      rotulo: "Casamento",
      grade: "colunas",
      densidade: "compacta",
      canto: "reto",
      alinhamento: "centro",
      alturaCapa: "cheia",
    }),
  },
  {
    id: "noite",
    rotulo: "Escura e cinematográfica",
    titulo: "Júlia & Tomás",
    slug: "julia-e-tomas",
    data: "8 de novembro de 2025",
    dataEvento: "2025-11-08",
    local: "Paraty",
    capa: "noite-1",
    fotos: fotosDaGrade("noite"),
    aparencia: lerAparencia({
      capa: "imersa",
      tema: "noite",
      tipografia: "serifada",
      grade: "editorial",
      densidade: "normal",
      canto: "suave",
      alturaCapa: "media",
    }),
  },
];

export const identidadePorId = (id: string) => IDENTIDADES.find((i) => i.id === id);

/**
 * A galeria que representa o produto nos pedaços que mostram UMA galeria só:
 * o celular de demonstração, a seleção, o cartão do cofre e os prints do
 * painel (`scripts/capturar-telas-home.mjs`). É a de fotos de verdade.
 */
export const GALERIA_EM_DESTAQUE: IdGaleria = "delicada";

/** A foto do cartão da galeria na seção "Cofre" (`CofreDemo`): a capa da galeria em destaque. */
export const LUGAR_DO_COFRE: IdFoto = `${GALERIA_EM_DESTAQUE}-1`;

/** A galeria de um lugar, ou `null` para o `respiro`. */
export function galeriaDoLugar(lugar: LugarDaHome): Identidade | null {
  if (lugar === "respiro") return null;
  return identidadePorId(lugar.slice(0, lugar.lastIndexOf("-"))) ?? null;
}

/** Como o admin chama cada lugar dentro da galeria: "Foto 1 · capa", "Foto 2"… */
export function nomeDoLugar(lugar: LugarDaHome): string {
  if (lugar === "respiro") return "Foto grande do fim";
  const n = lugar.slice(lugar.lastIndexOf("-") + 1);
  return galeriaDoLugar(lugar)?.capa === lugar ? `Foto ${n} · capa` : `Foto ${n}`;
}

/**
 * Onde a foto de cada lugar aparece na home — é o que a tela do admin mostra
 * ao lado dela. Sai das identidades, e não de uma lista escrita à mão: trocar
 * a capa de uma galeria aqui muda a frase lá sem ninguém lembrar.
 */
export function ondeAparece(lugar: LugarDaHome): string[] {
  if (lugar === "respiro") {
    return ['a foto grande de ponta a ponta, perto do fim ("O trabalho é seu")'];
  }
  const g = galeriaDoLugar(lugar);
  if (!g) return [];
  const pb = g.pretoEBranco ? " (em preto e branco)" : "";
  const onde: string[] = [];
  if (g.capa === lugar) onde.push(`a capa da galeria "${g.titulo}"${pb}`);
  onde.push(`a grade da galeria "${g.titulo}"${pb}`);
  if (lugar === LUGAR_DO_COFRE) onde.push('a miniatura do cartão na seção "Cofre"');
  if (g.id === GALERIA_EM_DESTAQUE) onde.push("o celular de demonstração e os prints do painel");
  return onde;
}

/*
 * ── O QUE O VISITANTE PODE TROCAR NA SEÇÃO "SUA MARCA" ────────────────────
 *
 * Um recorte das opções reais do editor — não todas: 22 fontes e 7 capas numa
 * fileira de botões viram um formulário, e a seção existe para mostrar que
 * trocar é instantâneo, não para substituir o editor. Os ids são os de
 * `OPCOES`; um id que deixar de existir lá cai no padrão via `lerAparencia`.
 */
export const TROCA_CAPAS = [
  { id: "imersa", nome: "Imersa" },
  { id: "jornal", nome: "Jornal" },
  { id: "dividida", nome: "Dividida" },
  { id: "convite", nome: "Convite" },
] as const;

export const TROCA_FONTES = [
  { id: "work", nome: "Work Sans" },
  { id: "bodoni", nome: "Bodoni" },
  { id: "manuscrita", nome: "Great Vibes" },
  { id: "jost", nome: "Jost" },
  { id: "serifada", nome: "Cormorant" },
] as const;

/* Três temas prontos e duas combinações de cores próprias — as duas coisas
   existem no editor (Cor → tema, e Cor → cores próprias). */
export const TROCA_CORES: {
  id: string;
  nome: string;
  tema: Aparencia["tema"];
  cores?: Aparencia["cores"];
  amostra: [string, string];
}[] = [
  {
    id: "terracota",
    nome: "Terracota",
    tema: "claro",
    cores: { fundo: "#f6f1ea", texto: "#1f1a16", destaque: "#d9472b" },
    amostra: ["#f6f1ea", "#d9472b"],
  },
  { id: "claro", nome: "Claro", tema: "claro", amostra: ["#ffffff", "#211d16"] },
  { id: "creme", nome: "Creme", tema: "creme", amostra: ["#f7f1e6", "#8c6f3f"] },
  { id: "noite", nome: "Noite", tema: "noite", amostra: ["#07080b", "#d9a441"] },
  {
    id: "mata",
    nome: "Mata",
    tema: "claro",
    cores: { fundo: "#eef1ec", texto: "#17231c", destaque: "#2f6b4f" },
    amostra: ["#eef1ec", "#2f6b4f"],
  },
];
