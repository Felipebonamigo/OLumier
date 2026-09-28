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
 * ── AS FOTOS MUDAM PELO ADMIN (28/09/2026) ────────────────────────────────
 *
 * Felipe mandou as primeiras fotos autorais e pediu para trocar as fotos da
 * home pela administração. Cada foto passou a ser um LUGAR — `foto1` a `foto8`
 * nas galerias de exemplo, `respiro` na foto grande perto do fim — com uma
 * foto PADRÃO aqui, no repositório. O admin troca a foto de um lugar
 * (`/painel/admin/home`), e a troca vale por cima do padrão até alguém voltar
 * ao padrão. Quem junta as duas coisas é `lib/fotos-da-home.ts`.
 *
 * Os lugares têm nome neutro de propósito. Antes eles se chamavam pelo que a
 * foto mostrava ("baloes", "praia"); com a foto trocável, o nome passaria a
 * mentir sobre o que está lá.
 *
 * O briefing da home (§24) pede curadoria autoral em cinco grupos, e cada
 * padrão leva o grupo que está segurando:
 *
 *   A · cor e vida    B · editorial    C · documental
 *   D · clássico      E · fora do casamento (nenhuma ainda)
 *
 * `foto5` a `foto8` ainda são as fotos provisórias do começo (Unsplash,
 * licença livre).
 *
 * ── OS NOMES ──────────────────────────────────────────────────────────────
 *
 * Nenhuma galeria leva nome de estúdio inventado: todas assinam "Seu Estúdio".
 * `PRODUCT.md` proíbe fabricar cliente, e um "Estúdio Aurora" numa vitrine de
 * exemplos é exatamente um cliente fabricado. Além disso, a frase que a seção
 * quer que o visitante escute é "isto pode ser o SEU".
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
  /** O grupo da curadoria que o padrão segura. A foto do admin não tem. */
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

export const LUGARES_DA_HOME = [
  "foto1",
  "foto2",
  "foto3",
  "foto4",
  "foto5",
  "foto6",
  "foto7",
  "foto8",
  "respiro",
] as const;

export type LugarDaHome = (typeof LUGARES_DA_HOME)[number];
/** Os lugares das galerias de exemplo — o `respiro` não entra em galeria. */
export type IdFoto = Exclude<LugarDaHome, "respiro">;
export type FotosDaHome = Record<LugarDaHome, FotoDemo>;

export function ehLugarDaHome(v: unknown): v is LugarDaHome {
  return typeof v === "string" && (LUGARES_DA_HOME as readonly string[]).includes(v);
}

/* Derivadas em WebP geradas com o sharp. As autorais têm lado maior de 1500 px
   (2000 no respiro, que ocupa a largura da tela), qualidade 76 — acima das
   provisórias porque a granulação delas some a 72. As dimensões são as do
   arquivo gerado: a grade usa a proporção para montar as fileiras antes da
   foto chegar. */
export const FOTOS_PADRAO: FotosDaHome = {
  foto1: {
    src: "/home/demo/convidados-chuva.webp",
    largura: 1000,
    altura: 1500,
    curadoria: "C",
    descricao: "Casal de convidados abraçado na cerimônia, debaixo de chuva",
    focoX: 45,
    focoY: 38,
  },
  foto2: {
    src: "/home/demo/terno-marrom.webp",
    largura: 1000,
    altura: 1500,
    curadoria: "B",
    descricao: "Noivos de mãos dadas, terno marrom e vestido tomara que caia",
    focoX: 50,
    focoY: 45,
  },
  foto3: {
    src: "/home/demo/guarda-chuva.webp",
    largura: 1000,
    altura: 1500,
    curadoria: "D",
    descricao: "Noivos caminhando pelo jardim debaixo de um guarda-chuva branco",
    focoX: 45,
    focoY: 58,
  },
  foto4: {
    src: "/home/demo/noiva-mesa-pb.webp",
    largura: 1000,
    altura: 1500,
    curadoria: "C",
    descricao: "A noiva sorrindo à mesa do jantar, em preto e branco",
    focoX: 50,
    focoY: 35,
  },
  foto5: {
    src: "/home/demo/cerimonia-arco.webp",
    largura: 1100,
    altura: 734,
    curadoria: "D",
    descricao: "Duas cadeiras de cerimônia no gramado",
    focoX: 50,
    focoY: 50,
  },
  foto6: {
    src: "/home/demo/maos-alianca.webp",
    largura: 1100,
    altura: 733,
    curadoria: "C",
    descricao: "Mãos com a aliança sobre o buquê",
    focoX: 50,
    focoY: 50,
  },
  foto7: {
    src: "/home/demo/noiva-retrato.webp",
    largura: 760,
    altura: 1140,
    curadoria: "C",
    descricao: "Casal rindo embaixo de uma palmeira",
    focoX: 50,
    focoY: 50,
  },
  foto8: {
    src: "/home/demo/noivos-beijo.webp",
    largura: 760,
    altura: 1140,
    curadoria: "A",
    descricao: "Beijo entre confetes e madrinhas de azul",
    focoX: 50,
    focoY: 50,
  },
  respiro: {
    src: "/home/demo/caminhada-grama.webp",
    largura: 2000,
    altura: 1333,
    curadoria: "B",
    descricao: "Os noivos caminhando pelo gramado, vistos da cintura para baixo",
    focoX: 50,
    focoY: 50,
  },
};

export interface Identidade {
  id: string;
  /** Como a seção de exemplos chama o jeito de fotografar — não é nome de preset. */
  rotulo: string;
  titulo: string;
  /** O fim do endereço na barra do navegador desenhado em volta da galeria. */
  slug: string;
  data: string;
  local: string;
  capa: IdFoto;
  fotos: IdFoto[];
  aparencia: Aparencia;
  /**
   * Tratamento de PLACEHOLDER. A galeria editorial precisa ler como outro
   * fotógrafo, e com as mesmas oito fotos coloridas não leria; em preto e
   * branco lê. Sai quando chegar a curadoria do grupo B — não é recurso do
   * produto, e a página não diz que é.
   */
  pretoEBranco?: boolean;
}

export const IDENTIDADES: Identidade[] = [
  {
    id: "viva",
    rotulo: "Documental e colorida",
    titulo: "Marina & Caio",
    slug: "marina-e-caio",
    data: "12 de outubro de 2025",
    local: "Olinda",
    capa: "foto1",
    fotos: ["foto8", "foto6", "foto7", "foto1", "foto4", "foto2", "foto5", "foto3"],
    aparencia: lerAparencia({
      capa: "imersa",
      tema: "claro",
      cores: { fundo: "#f6f1ea", texto: "#1f1a16", destaque: "#d9472b" },
      tipografia: "work",
      peso: "forte",
      grade: "colunas",
      densidade: "normal",
      canto: "reto",
      alinhamento: "esquerda",
      alturaCapa: "media",
      fonteDetalhe: "texto",
    }),
  },
  {
    id: "editorial",
    rotulo: "Editorial e sóbria",
    titulo: "Helena e Rafael",
    slug: "helena-e-rafael",
    data: "Março de 2026",
    local: "São Paulo",
    capa: "foto2",
    fotos: ["foto4", "foto2", "foto6", "foto7", "foto3", "foto5", "foto8", "foto1"],
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
    id: "classica",
    rotulo: "Natural e clássica",
    titulo: "Ana & Pedro",
    slug: "ana-e-pedro",
    data: "21 de março de 2026",
    local: "Serra Gaúcha",
    capa: "foto3",
    fotos: ["foto7", "foto6", "foto5", "foto2", "foto8", "foto3", "foto4", "foto1"],
    aparencia: lerAparencia({
      capa: "convite",
      tema: "creme",
      tipografia: "manuscrita",
      grade: "linhas",
      densidade: "normal",
      canto: "suave",
      alturaCapa: "media",
    }),
  },
  {
    id: "noite",
    rotulo: "Escura e cinematográfica",
    titulo: "Júlia & Tomás",
    slug: "julia-e-tomas",
    data: "8 de novembro de 2025",
    local: "Paraty",
    capa: "foto4",
    fotos: ["foto3", "foto7", "foto5", "foto8", "foto6", "foto2", "foto1", "foto4"],
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

/** Como o admin chama cada lugar: "Foto 1" a "Foto 8", e a do fim. */
export function nomeDoLugar(lugar: LugarDaHome): string {
  return lugar === "respiro" ? "Foto grande do fim" : `Foto ${lugar.slice("foto".length)}`;
}

/** A foto do cartão da galeria na seção "Cofre" (`CofreDemo`). */
export const LUGAR_DO_COFRE: IdFoto = "foto3";

/**
 * Onde a foto de cada lugar aparece na home — é o que a tela do admin mostra
 * ao lado dela. Sai das identidades, e não de uma lista escrita à mão: trocar
 * a capa de um exemplo aqui muda a frase lá sem ninguém lembrar.
 */
export function ondeAparece(lugar: LugarDaHome): string[] {
  if (lugar === "respiro") {
    return ['a foto grande de ponta a ponta, perto do fim ("O trabalho é seu")'];
  }
  const onde: string[] = [];
  for (const i of IDENTIDADES) {
    if (i.capa === lugar) {
      onde.push(`capa do exemplo "${i.rotulo}"${i.pretoEBranco ? " (em preto e branco)" : ""}`);
    }
  }
  if (lugar === LUGAR_DO_COFRE) onde.push('a miniatura do cartão na seção "Cofre"');
  onde.push("a grade das galerias de exemplo e do celular de demonstração");
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
