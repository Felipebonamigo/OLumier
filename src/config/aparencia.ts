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
export type Tipografia = "serifada" | "moderna" | "manuscrita";
export type Grade = "colunas" | "linhas" | "quadrada" | "editorial";
export type Densidade = "compacta" | "normal" | "arejada";

export interface Aparencia {
  capa: Capa;
  tema: Tema;
  tipografia: Tipografia;
  grade: Grade;
  densidade: Densidade;
}

export const APARENCIA_PADRAO: Aparencia = {
  capa: "imersa",
  tema: "noite",
  tipografia: "serifada",
  grade: "colunas",
  densidade: "normal",
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
  };
}

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
  tipografia: [
    { id: "serifada", nome: "Serifada", desc: "Clássica e elegante" },
    { id: "moderna", nome: "Moderna", desc: "Sem serifa, direta" },
    { id: "manuscrita", nome: "Manuscrita", desc: "Assinatura, romântica" },
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
    id: "olumier",
    nome: "Olumier",
    desc: "Escura e cinematográfica. A foto é a única fonte de luz.",
    aparencia: { capa: "imersa", tema: "noite", tipografia: "serifada", grade: "editorial", densidade: "normal" },
  },
  {
    id: "revista",
    nome: "Revista",
    desc: "Fundo claro, tipografia grande, mural de colunas.",
    aparencia: { capa: "jornal", tema: "claro", tipografia: "serifada", grade: "colunas", densidade: "normal" },
  },
  {
    id: "atelie",
    nome: "Ateliê",
    desc: "Tons terrosos e manuscrita. Clima de convite de casamento.",
    aparencia: { capa: "dividida", tema: "creme", tipografia: "manuscrita", grade: "linhas", densidade: "arejada" },
  },
  {
    id: "essencial",
    nome: "Essencial",
    desc: "Sem firula: entra direto nas fotos, tudo do mesmo tamanho.",
    aparencia: { capa: "minima", tema: "claro", tipografia: "moderna", grade: "quadrada", densidade: "compacta" },
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
  noite: {
    "--g-fundo": "#0d0b09",
    "--g-superficie": "#16120e",
    "--g-texto": "#ece4d6",
    "--g-suave": "#b3a58f",
    "--g-tenue": "#7d715f",
    "--g-linha": "rgba(240,221,190,.16)",
    "--g-destaque": "#f0c268",
    "--g-sobre-destaque": "#1a1409",
  },
  claro: {
    "--g-fundo": "#ffffff",
    "--g-superficie": "#f6f5f3",
    "--g-texto": "#1c1a17",
    "--g-suave": "#5f5a52",
    "--g-tenue": "#918a80",
    "--g-linha": "rgba(28,26,23,.14)",
    "--g-destaque": "#1c1a17",
    "--g-sobre-destaque": "#ffffff",
  },
  creme: {
    "--g-fundo": "#fbf8f2",
    "--g-superficie": "#f2ebdd",
    "--g-texto": "#463b2e",
    "--g-suave": "#7c6e5b",
    "--g-tenue": "#a99a85",
    "--g-linha": "rgba(70,59,46,.16)",
    "--g-destaque": "#927659",
    "--g-sobre-destaque": "#fbf6ee",
  },
};

/**
 * Aponta para as variáveis que o next/font define no <body> — e NÃO para os
 * tokens do Tailwind (--font-serif e afins). O `@theme inline` embute os valores
 * nas classes utilitárias em vez de publicar a variável no :root, então
 * `var(--font-serif)` não existe em tempo de execução e o título cairia na fonte
 * padrão do sistema.
 */
export const FONTES_TITULO: Record<Tipografia, string> = {
  serifada: 'var(--font-serif-app), "Iowan Old Style", Palatino, Georgia, serif',
  moderna: 'var(--font-sans-app), system-ui, "Segoe UI", sans-serif',
  manuscrita: 'var(--font-script-app), "Segoe Script", cursive',
};

/** Espaçamento entre as fotos e quantas cabem por linha. */
export const DENSIDADES: Record<Densidade, { gap: string; colunas: number }> = {
  compacta: { gap: "0.25rem", colunas: 5 },
  normal: { gap: "0.5rem", colunas: 4 },
  arejada: { gap: "1.25rem", colunas: 3 },
};
