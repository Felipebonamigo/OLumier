/**
 * O QUE A GRADE DA ABA "FOTOS E VÍDEOS" ESTÁ MOSTRANDO (01/10/2026).
 *
 * Juan: "Subi 200 fotos em um capítulo X. Mas, 6 fotos repetiram, quero
 * remover elas. Impossível eu achar na aba de fotos ali embaixo. Eu não
 * consigo ver apenas as fotos que estão dentro do capítulo X e remover elas.
 * Eu tenho que catar lá (…) fotos que tem 4k de fotos." E: "Ainda não tem
 * como visualizar as fotos que tem em cada capítulo."
 *
 * A grade passa a mostrar um recorte: todas, um capítulo, as sem capítulo, ou
 * só as repetidas. Quem escolhe é a própria grade (as fichas em cima dela),
 * mas também a lista de capítulos ("ver as fotos" em cada linha) e o aviso de
 * repetidas — três componentes irmãos na página. Por isso o recorte mora
 * aqui, fora do React, como `lib/miniaturas-do-painel.ts`: cada um lê e muda
 * pelo mesmo lugar, sem a página voltar ao servidor.
 *
 * Por galeria: trocar de galeria no painel começa de novo em "todas".
 */

/** "todas" · "repetidas" · "sem-capitulo" · "cap:<id do capítulo>" */
export type FiltroDaGrade = string;

export interface EstadoDaGrade {
  filtro: FiltroDaGrade;
  /** A grade aberta ou recolhida — "ver as fotos" de um capítulo abre. */
  aberta: boolean;
}

export const ESTADO_INICIAL: EstadoDaGrade = { filtro: "todas", aberta: true };

const estados = new Map<string, EstadoDaGrade>();
const ouvintes = new Map<string, Set<() => void>>();

export function lerEstadoDaGrade(galeriaId: string): EstadoDaGrade {
  return estados.get(galeriaId) ?? ESTADO_INICIAL;
}

export function ouvirEstadoDaGrade(galeriaId: string, fn: () => void): () => void {
  let daGaleria = ouvintes.get(galeriaId);
  if (!daGaleria) ouvintes.set(galeriaId, (daGaleria = new Set()));
  daGaleria.add(fn);
  return () => {
    daGaleria.delete(fn);
  };
}

export function mudarEstadoDaGrade(galeriaId: string, mudanca: Partial<EstadoDaGrade>): void {
  estados.set(galeriaId, { ...lerEstadoDaGrade(galeriaId), ...mudanca });
  for (const fn of ouvintes.get(galeriaId) ?? []) fn();
}

/** O `id` da `<section>` da grade, para quem manda a pessoa até ela. */
export const ID_DA_GRADE = "grade-de-arquivos";

/**
 * Mostra um recorte na grade e leva a tela até ela. É o que "ver as fotos" do
 * capítulo e "ver as repetidas" do aviso chamam.
 */
export function verNaGrade(galeriaId: string, filtro: FiltroDaGrade): void {
  mudarEstadoDaGrade(galeriaId, { filtro, aberta: true });
  if (typeof document === "undefined") return;
  /* Depois do desenho: a grade pode estar recolhida, e só existe aberta. */
  requestAnimationFrame(() =>
    document.getElementById(ID_DA_GRADE)?.scrollIntoView({ behavior: "smooth", block: "start" }),
  );
}

/* ── AS REPETIDAS ─────────────────────────────────────────────────────────
 *
 * Repetida é MESMO NOME E MESMO TAMANHO — a mesma régua do aviso do topo
 * (`fotosRepetidas`). Mesmo nome com tamanho diferente são fotos distintas
 * que se chamam igual, e isso está certo.
 *
 * Em cada grupo, uma fica e as outras são "cópias extras". Fica a que o
 * cliente marcou como favorita ou baixou (apagar a cópia escolhida levaria a
 * marcação junto), e, empatando, a primeira na ordem da galeria.
 *
 * Pura: `scripts/testar-filtro-da-grade.mjs` cobre sem navegador.
 */
export interface ArquivoParaRepetir {
  id: string;
  nome: string;
  bytes: number;
  favoritas?: number;
  baixadas?: number;
}

export function copiasRepetidas<T extends ArquivoParaRepetir>(
  arquivos: T[],
): { repetidas: Set<string>; extras: string[]; grupos: number } {
  const porChave = new Map<string, T[]>();
  for (const a of arquivos) {
    const chave = `${a.nome}\u0000${a.bytes}`;
    const grupo = porChave.get(chave);
    if (grupo) grupo.push(a);
    else porChave.set(chave, [a]);
  }
  const repetidas = new Set<string>();
  const extras: string[] = [];
  let grupos = 0;
  for (const grupo of porChave.values()) {
    if (grupo.length < 2) continue;
    grupos++;
    for (const a of grupo) repetidas.add(a.id);
    const peso = (a: T) => (a.favoritas ?? 0) * 1000 + (a.baixadas ?? 0);
    let fica = grupo[0];
    for (const a of grupo) if (peso(a) > peso(fica)) fica = a;
    for (const a of grupo) if (a !== fica) extras.push(a.id);
  }
  return { repetidas, extras, grupos };
}
