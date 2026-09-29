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
 * SUAS FOTOS: a Vanessa & Kalil, as do casamento dela; a Laura & Romulo, as
 * da galeria do Juan, no lugar da "Ana & Pedro"; as outras duas, as
 * provisórias do começo (Unsplash, licença livre), até chegarem galerias de
 * verdade para elas.
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
 * Kalil e a Laura & Romulo são casamentos de verdade, com o nome que o Felipe
 * passou; as outras duas são inventadas, como sempre foram.
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
 * As fotos de verdade moram numa pasta por casamento
 * (`public/home/demo/<casamento>/`): WebP de 1500 px no lado maior (2000 no
 * gramado da Vanessa & Kalil, que é a foto grande do fim), qualidade 76 —
 * acima das provisórias porque a granulação some a 72. As provisórias ficam
 * soltas em `public/home/demo/`: 1100 px, qualidade 72. As medidas são as do
 * arquivo: a grade monta as fileiras pela proporção antes de a foto chegar, e
 * `testar-fotos-da-home` confere uma por uma.
 */
const VK = "/home/demo/vanessa-e-kalil";
const LR = "/home/demo/laura-e-romulo";
const vertical = { largura: 1000, altura: 1500 } as const;
const deitada = { largura: 1500, altura: 1000 } as const;

const ACERVO = {
  // Vanessa & Kalil — 1º de maio de 2026, Porto Alegre. Fotos da Carol.
  guardaChuva: { src: `${VK}/guarda-chuva.webp`, ...vertical, curadoria: "D", descricao: "Noivos caminhando pelo jardim debaixo de um guarda-chuva branco", focoX: 45, focoY: 58 },
  noivaVeu: { src: `${VK}/noiva-veu.webp`, ...vertical, descricao: "A noiva de véu, com o buquê de rosas brancas", focoX: 50, focoY: 30 },
  noivaNaPorta: { src: `${VK}/noiva-na-porta.webp`, ...vertical, descricao: "A noiva de costas na porta, com as madrinhas esperando lá fora", focoX: 50, focoY: 55 },
  maosNoAltar: { src: `${VK}/maos-no-altar.webp`, ...vertical, descricao: "As mãos dadas no altar: terno marrom e vestido branco", focoX: 50, focoY: 50 },
  convidadosChuva: { src: `${VK}/convidados-chuva.webp`, ...vertical, curadoria: "C", descricao: "Casal de convidados abraçado na cerimônia, debaixo de chuva", focoX: 45, focoY: 38 },
  saida: { src: `${VK}/saida.webp`, ...vertical, descricao: "Os noivos saindo da cerimônia de braços para o alto", focoX: 55, focoY: 40 },
  ternoMarrom: { src: `${VK}/terno-marrom.webp`, ...vertical, curadoria: "B", descricao: "Noivos de mãos dadas, terno marrom e vestido tomara que caia", focoX: 50, focoY: 45 },
  noivosTijolos: { src: `${VK}/noivos-tijolos.webp`, ...vertical, descricao: "Os noivos diante da parede de tijolos", focoX: 50, focoY: 45 },
  noivosCadeira: { src: `${VK}/noivos-cadeira.webp`, ...vertical, descricao: "Os noivos no jardim, em frente à casa de pedra", focoX: 50, focoY: 55 },
  madrinhas: { src: `${VK}/madrinhas-marrom.webp`, ...vertical, descricao: "As madrinhas de marrom em volta da noiva, no gramado", focoX: 50, focoY: 65 },
  noivoBrinde: { src: `${VK}/noivo-brinde.webp`, ...vertical, descricao: "O noivo tomando um gole entre os convidados", focoX: 55, focoY: 35 },
  ramos: { src: `${VK}/ramos.webp`, ...vertical, descricao: "Ramos verdes contra o céu nublado", focoX: 50, focoY: 50 },
  noivaMesa: { src: `${VK}/noiva-mesa-pb.webp`, ...vertical, curadoria: "C", descricao: "A noiva sorrindo à mesa do jantar, em preto e branco", focoX: 50, focoY: 35 },
  caminhada: { src: `${VK}/caminhada-grama.webp`, largura: 2000, altura: 1333, curadoria: "B", descricao: "Os noivos caminhando pelo gramado, vistos da cintura para baixo", focoX: 50, focoY: 50 },

  // Laura & Romulo — a galeria do Juan.
  lrCasaDePedra: { src: `${LR}/09-beijo-casa-pedra.webp`, ...deitada, descricao: "O beijo no gramado, diante da casa de pedra", focoX: 50, focoY: 68 },
  lrMaosDadas: { src: `${LR}/01-maos-dadas-lago.webp`, ...vertical, descricao: "Os noivos de mãos dadas no campo, com o lago e o morro atrás", focoX: 50, focoY: 60 },
  lrCaminhadaPb: { src: `${LR}/02-caminhada-pb.webp`, ...vertical, descricao: "Em preto e branco, os noivos caminhando pelo campo", focoX: 50, focoY: 60 },
  lrBeijoArvore: { src: `${LR}/03-beijo-arvore.webp`, ...vertical, descricao: "O beijo debaixo da árvore grande, o véu na grama", focoX: 45, focoY: 65 },
  lrAbraco: { src: `${LR}/04-abraco.webp`, ...vertical, descricao: "O casal abraçado, testa com testa", focoX: 50, focoY: 35 },
  lrGiro: { src: `${LR}/05-giro.webp`, ...vertical, descricao: "A noiva girando pela mão do noivo, no campo", focoX: 50, focoY: 60 },
  lrSentados: { src: `${LR}/06-sentados-grama.webp`, ...deitada, descricao: "Os noivos sentados na grama, com o morro atrás", focoX: 55, focoY: 70 },
  lrCorrendo: { src: `${LR}/07-correndo-tremido.webp`, ...vertical, descricao: "Os dois correndo de mãos dadas, tremidos", focoX: 50, focoY: 45 },
  lrAbracoSol: { src: `${LR}/08-abraco-sol.webp`, ...vertical, descricao: "Abraço contra o sol, a mão dela no rosto dele", focoX: 60, focoY: 25 },
  lrNoivaCostas: { src: `${LR}/10-noiva-costas.webp`, ...vertical, descricao: "A noiva de costas, olhando por cima do ombro", focoX: 50, focoY: 35 },
  lrSol: { src: `${LR}/11-sol-estourado.webp`, ...vertical, descricao: "Os noivos no campo, com o sol estourando atrás", focoX: 50, focoY: 55 },
  lrBuque: { src: `${LR}/12-buque.webp`, ...vertical, descricao: "O buquê sobre o vestido, na grama", focoX: 40, focoY: 55 },
  lrRetratoNoiva: { src: `${LR}/13-retrato-noiva.webp`, ...vertical, descricao: "Retrato da noiva, a mão no cabelo", focoX: 45, focoY: 45 },
  lrContraluz: { src: `${LR}/14-contraluz.webp`, ...vertical, descricao: "Contraluz dourado: o beijo na testa, o lago atrás", focoX: 50, focoY: 45 },
  lrRindo: { src: `${LR}/15-rindo.webp`, ...vertical, descricao: "Os dois rindo para a câmera no sol do fim da tarde", focoX: 55, focoY: 35 },
  lrArvoreTremida: { src: `${LR}/16-arvore-tremida.webp`, ...vertical, descricao: "A árvore enorme e os noivos pequenos, tremidos", focoX: 50, focoY: 80 },
  lrBeijoPb: { src: `${LR}/17-beijo-pb.webp`, ...vertical, descricao: "Em preto e branco, o beijo de perto e a aliança na mão", focoX: 50, focoY: 40 },
  lrCorrendoGrama: { src: `${LR}/18-correndo-grama.webp`, ...vertical, descricao: "Correndo pela grama, de mãos dadas", focoX: 50, focoY: 40 },
  lrNuvens: { src: `${LR}/19-nuvens.webp`, ...deitada, descricao: "Nuvens alaranjadas no céu do fim da tarde", focoX: 50, focoY: 50 },
  lrArvoreEnorme: { src: `${LR}/20-arvore-enorme.webp`, ...vertical, descricao: "Os noivos ao pé da árvore enorme", focoX: 45, focoY: 85 },
  lrCaminhoDaCasa: { src: `${LR}/21-caminho-da-casa.webp`, ...vertical, descricao: "Os noivos caminhando para a casa de pedra, ela olhando para trás", focoX: 55, focoY: 75 },
  lrMuro: { src: `${LR}/22-muro-de-pedra.webp`, ...vertical, descricao: "Os noivos sentados no muro de pedra, o véu espalhado", focoX: 50, focoY: 60 },
  lrRetratoMuro: { src: `${LR}/23-retrato-muro.webp`, ...vertical, descricao: "Retrato dos dois no muro de pedra, olhando para a câmera", focoX: 50, focoY: 35 },
  lrBeijoDeLado: { src: `${LR}/24-beijo-de-lado-pb.webp`, ...vertical, descricao: "Em preto e branco, o beijo visto de lado", focoX: 50, focoY: 50 },
  lrPorteira: { src: `${LR}/25-porteira.webp`, ...vertical, descricao: "O noivo segurando a cauda do vestido na porteira", focoX: 55, focoY: 70 },

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
  /* Na ordem do dia: a noiva pronta, a entrada, a cerimônia, a saída, os
     retratos, a festa.

     A CAPA É O RETRATO NA CADEIRA (29/09/2026). Felipe, com o print da home
     e a foto: "mude a capa da primeira imagem, para a da segunda". Era o
     guarda-chuva, que passa para o lugar 9, entre os retratos — a troca é
     só entre os dois lugares, para nenhuma foto trocada pelo admin em outro
     lugar mudar de posição. */
  delicada: [
    ACERVO.noivosCadeira,
    ACERVO.noivaVeu,
    ACERVO.noivaNaPorta,
    ACERVO.maosNoAltar,
    ACERVO.convidadosChuva,
    ACERVO.saida,
    ACERVO.ternoMarrom,
    ACERVO.noivosTijolos,
    ACERVO.guardaChuva,
    ACERVO.madrinhas,
    ACERVO.noivoBrinde,
    ACERVO.ramos,
    ACERVO.noivaMesa,
    ACERVO.caminhada,
  ],
  editorial: [ACERVO.praia, ACERVO.maos, ACERVO.alianca, ACERVO.palmeira, ACERVO.contraluz, ACERVO.cadeiras, ACERVO.confete, ACERVO.baloes],
  /*
   * A CAPA É A QUE O JUAN MARCOU (28/09/2026).
   *
   * Aqui vinha primeiro a casa de pedra, escolhida por ser DEITADA — a capa
   * "jornal" é larga, e uma foto em pé pede mais recorte. Só que ele tinha
   * marcado outra: "uma das fotos eu sinalizei com o nome 'capa'", o beijo
   * debaixo da árvore grande, com o véu espalhado na grama.
   *
   * O formato é razão nossa; a escolha é dele. Numa página cujo argumento é
   * "a marca do fotógrafo fica na frente", exibir a galeria dele com a capa
   * que NÓS preferimos contradiz o que a própria página afirma. O recorte se
   * resolve com o ponto focal (45/65, o casal no terço de baixo).
   *
   * Depois dela, as outras na ordem em que ele mandou.
   */
  classica: [
    ACERVO.lrBeijoArvore,
    ACERVO.lrCasaDePedra,
    ACERVO.lrMaosDadas,
    ACERVO.lrCaminhadaPb,
    ACERVO.lrAbraco,
    ACERVO.lrGiro,
    ACERVO.lrSentados,
    ACERVO.lrCorrendo,
    ACERVO.lrAbracoSol,
    ACERVO.lrNoivaCostas,
    ACERVO.lrSol,
    ACERVO.lrBuque,
    ACERVO.lrRetratoNoiva,
    ACERVO.lrContraluz,
    ACERVO.lrRindo,
    ACERVO.lrArvoreTremida,
    ACERVO.lrBeijoPb,
    ACERVO.lrCorrendoGrama,
    ACERVO.lrNuvens,
    ACERVO.lrArvoreEnorme,
    ACERVO.lrCaminhoDaCasa,
    ACERVO.lrMuro,
    ACERVO.lrRetratoMuro,
    ACERVO.lrBeijoDeLado,
    ACERVO.lrPorteira,
  ],
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
  /** Vazia quando ainda não sabemos: a capa some com a legenda, não inventa. */
  data: string;
  /** A mesma data, para o banco — o script dos prints cria a galeria com ela. */
  dataEvento: string | null;
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
     * ── LAURA & ROMULO (28/09/2026) ────────────────────────────────────────
     *
     * A galeria do Juan, no lugar da "Ana & Pedro" inventada — as 25 fotos
     * que o Felipe mandou. Sem data e sem lugar: ainda não vieram, e a capa
     * de um casamento de verdade não leva data inventada. Com os dois vazios
     * a legenda da capa simplesmente não aparece (`GaleriaCapa`).
     */
    id: "classica",
    rotulo: "Natural e contemporânea",
    titulo: "Laura & Romulo",
    slug: "laura-e-romulo",
    data: "",
    dataEvento: null,
    local: "",
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
