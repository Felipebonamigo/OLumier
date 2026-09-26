import { lerAparencia, type Aparencia } from "@/config/aparencia";

/**
 * AS GALERIAS DE DEMONSTRAÇÃO DA HOME — fotos e identidades.
 *
 * ── O QUE ESTÁ AQUI É DE VERDADE, MENOS AS FOTOS ──────────────────────────
 *
 * Cada identidade abaixo é uma `Aparencia` que o editor de Design produz:
 * mesmas capas, mesmas fontes, mesmos temas, mesmas grades, desenhadas pelos
 * mesmos componentes que o cliente vê (`GaleriaCapa`, `GaleriaGrade`). A home
 * não tem um desenho próprio de "galeria de mentira" — se o produto mudar, a
 * vitrine muda junto.
 *
 * As FOTOS é que são provisórias. O briefing da home (§24) pede uma curadoria
 * autoral em cinco grupos, e o ambiente onde isto foi montado não alcança
 * banco de imagem nenhum: só havia as oito fotos de casamento de `public/home`
 * (Unsplash, licença livre). Cada foto leva o GRUPO da curadoria que ela está
 * segurando, para a troca ser um caminho de arquivo por slot.
 *
 *   A · cor e vida    B · editorial    C · documental
 *   D · clássico      E · fora do casamento (nenhuma ainda)
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
  largura: number;
  altura: number;
  curadoria: Curadoria;
  /** O que a foto mostra — para o `alt` e para quem for trocá-la. */
  descricao: string;
}

/* Derivadas em WebP de `public/home/*.jpg`, geradas com o sharp (lado maior
   1100 px, qualidade 72). As dimensões são as do arquivo gerado: a grade usa a
   proporção para montar as fileiras antes da foto chegar. */
export const FOTOS = {
  cadeiras: {
    src: "/home/demo/cerimonia-arco.webp",
    largura: 1100,
    altura: 734,
    curadoria: "D",
    descricao: "Duas cadeiras de cerimônia no gramado",
  },
  baloes: {
    src: "/home/demo/festa-mesa.webp",
    largura: 1100,
    altura: 734,
    curadoria: "A",
    descricao: "Casal soltando balões vermelhos com os convidados",
  },
  contraluz: {
    src: "/home/demo/hero-casamento.webp",
    largura: 1100,
    altura: 733,
    curadoria: "D",
    descricao: "Casal em contraluz segurando o buquê",
  },
  maos: {
    src: "/home/demo/madrinhas.webp",
    largura: 1100,
    altura: 733,
    curadoria: "B",
    descricao: "Mãos dadas e a sombra do casal na grama",
  },
  alianca: {
    src: "/home/demo/maos-alianca.webp",
    largura: 1100,
    altura: 733,
    curadoria: "C",
    descricao: "Mãos com a aliança sobre o buquê",
  },
  palmeira: {
    src: "/home/demo/noiva-retrato.webp",
    largura: 760,
    altura: 1140,
    curadoria: "C",
    descricao: "Casal rindo embaixo de uma palmeira",
  },
  confete: {
    src: "/home/demo/noivos-beijo.webp",
    largura: 760,
    altura: 1140,
    curadoria: "A",
    descricao: "Beijo entre confetes e madrinhas de azul",
  },
  praia: {
    src: "/home/demo/vestido.webp",
    largura: 760,
    altura: 1140,
    curadoria: "B",
    descricao: "Casal na praia com o véu ao vento",
  },
} as const satisfies Record<string, FotoDemo>;

export type IdFoto = keyof typeof FOTOS;

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
    capa: "baloes",
    fotos: ["confete", "alianca", "palmeira", "baloes", "maos", "praia", "cadeiras", "contraluz"],
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
    capa: "praia",
    fotos: ["maos", "praia", "alianca", "palmeira", "contraluz", "cadeiras", "confete", "baloes"],
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
    capa: "contraluz",
    fotos: ["palmeira", "alianca", "cadeiras", "praia", "confete", "contraluz", "maos", "baloes"],
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
    capa: "maos",
    fotos: ["contraluz", "palmeira", "cadeiras", "confete", "alianca", "praia", "baloes", "maos"],
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
