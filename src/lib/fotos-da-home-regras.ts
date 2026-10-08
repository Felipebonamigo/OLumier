/**
 * As regras das FOTOS DA PÁGINA INICIAL, sem banco e sem bucket.
 *
 * Puro de propósito, como `lib/marca-estudio.ts`: o teste
 * (`scripts/testar-fotos-da-home.mjs`) exercita estas funções direto, e a
 * rota e a tela usam as mesmas — a regra que o teste prende é a que roda.
 *
 * Quem junta com o banco é `lib/fotos-da-home.ts`; a história inteira está no
 * comentário de `config/home-demonstracao.ts` e da migração 043.
 */
import { ehLugarDaHome, type FotoDemo, type FotosDaHome, type LugarDaHome } from "@/config/home-demonstracao";

/** Uma linha de `fotos_da_home`, como o banco devolve. */
export interface LinhaFotoDaHome {
  lugar: string;
  chave: string;
  chave_miniatura: string | null;
  largura: number;
  altura: number;
  descricao: string;
  foco_x: number;
  foco_y: number;
}

/** Uma linha de `focos_da_home` — o foco ajustado de uma foto PADRÃO. */
export interface LinhaFocoDaHome {
  lugar: string;
  foco_x: number;
  foco_y: number;
}

export type TamanhoDaFotoDaHome = "foto" | "miniatura";

/**
 * 25 MB por arquivo. O que sobe não é o original: são as derivadas que o
 * navegador gera (2048 px e 640 px, em WebP), as mesmas do envio de uma
 * galeria. Uma de 2048 px com muita granulação passa de 2 MB; 25 MB é folga
 * para qualquer foto de verdade e barra arquivo que não é derivada.
 */
export const LIMITE_FOTO_DA_HOME = 25 * 1024 * 1024;

/** Só WebP: é o que `gerarDerivadas` produz. Outra coisa não veio dela. */
export const MIME_FOTO_DA_HOME = "image/webp";

export function recusaDaFotoDaHome(mime: string, bytes: number): string | null {
  if (mime !== MIME_FOTO_DA_HOME) return "A foto precisa chegar em WebP — tente enviar de novo.";
  if (!Number.isFinite(bytes) || bytes <= 0) return "Arquivo vazio ou inválido.";
  if (bytes > LIMITE_FOTO_DA_HOME) return "A foto passou de 25 MB depois de reduzida.";
  return null;
}

/**
 * Onde a foto de um lugar mora no bucket.
 *
 * `plataforma/` e não `<tenant>/`: a foto é da plataforma, não de um estúdio,
 * e é esse primeiro pedaço que mantém a varredura de órfãos longe dela (ver a
 * migração 043). O uuid no nome faz a troca virar link novo — o navegador não
 * mostra a foto antiga do cache.
 */
export function chaveDaFotoDaHome(lugar: LugarDaHome, tamanho: TamanhoDaFotoDaHome): string {
  return `plataforma/home/${lugar}/${crypto.randomUUID()}-${tamanho}.webp`;
}

/**
 * A chave veio do navegador: só vale se for de ESTE lugar e deste tamanho.
 *
 * Sem isto, um pedido de confirmação forjado apontaria o lugar para qualquer
 * objeto do bucket — a foto de casamento de um cliente, inclusive, que a home
 * passaria a mostrar para todo mundo.
 */
export function ehChaveDaFotoDaHome(
  chave: unknown,
  lugar: LugarDaHome,
  tamanho: TamanhoDaFotoDaHome,
): chave is string {
  if (typeof chave !== "string") return false;
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  return new RegExp(`^plataforma/home/${lugar}/${uuid}-${tamanho}\\.webp$`).test(chave);
}

/** O `alt` da foto: sem quebra de linha, espaço repetido ou texto sem fim. */
export function normalizarDescricao(bruta: unknown): string {
  return String(bruta ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Foco em % inteiro, de 0 a 100. Lixo vira o centro. */
export function normalizarFoco(bruto: unknown): number {
  const n = Number(bruto);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * A faixa larga que a tela do admin usa para mostrar o recorte (5:2, a mesma
 * proporção de `aspect-[5/2]` em `foto-da-home-admin.tsx`).
 */
export const RAZAO_DA_FAIXA_LARGA = 5 / 2;

/** Quanto da ALTURA da foto a faixa larga mostra (1 = a foto inteira, sem corte vertical). */
export function fracaoVistaNaFaixa(largura: number, altura: number): number {
  if (!(largura > 0) || !(altura > 0)) return 1;
  return Math.min(1, largura / altura / RAZAO_DA_FAIXA_LARGA);
}

/**
 * O foco (`object-position`, em %) que deixa o ponto clicado no MEIO da faixa.
 *
 * `object-position: y%` não é "o ponto no centro": em y% a borda de cima do
 * recorte fica em y% da folga, e o ponto de y% da foto cai perto do TOPO da
 * faixa — clicar no rosto deixava a cabeça rente à borda, e foi assim que
 * "cortou a cabeça da mulher" (Juan, 07/10/2026). Aqui o clique vira o foco que
 * centraliza: o recorte de altura `vista` cobre [p − vista/2, p + vista/2], e o
 * resultado encosta em 0 ou 100 quando o ponto está perto da borda da foto.
 */
export function focoQueCentraliza(clique: number, vista: number): number {
  if (vista >= 1) return normalizarFoco(clique);
  return normalizarFoco(((clique - 50 * vista) / (1 - vista)));
}

/** O inverso: onde fica, na foto (em %), o meio da faixa para um foco salvo. */
export function centroDaFaixa(foco: number, vista: number): number {
  if (vista >= 1) return foco;
  return foco * (1 - vista) + 50 * vista;
}

/** Dimensão plausível de foto: inteiro de 1 a 30 mil pixels. */
export function dimensaoValida(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 30_000;
}

/**
 * O endereço FIXO de uma foto trocada — a rota que redireciona para o link
 * assinado do bucket (`api/home/foto/[lugar]`).
 *
 * A home fica em cache (é estática, regenerada quando a foto muda), e um link
 * assinado posto direto no HTML expiraria antes do cache: a página seguiria no
 * ar com as fotos quebradas. A rota assina na hora de cada visita.
 *
 * `v` é o nome do arquivo: muda a cada troca, e é o que impede o navegador de
 * reaproveitar o redirecionamento da foto anterior.
 */
export function urlDaFotoDaHome(lugar: LugarDaHome, chave: string, tamanho: TamanhoDaFotoDaHome): string {
  const versao = chave.slice(chave.lastIndexOf("/") + 1).replace(/\.webp$/, "");
  const t = tamanho === "miniatura" ? "&t=miniatura" : "";
  return `/api/home/foto/${lugar}?v=${encodeURIComponent(versao)}${t}`;
}

/**
 * As fotos da home: o padrão do repositório, com as trocas do admin por cima.
 *
 * Linha com lugar desconhecido (um lugar que saiu do código) ou medida
 * impossível é ignorada — o lugar fica com o padrão. A home nunca quebra por
 * causa de uma linha ruim; no pior caso mostra a foto de antes.
 *
 * `focos` são os ajustes de foco das fotos PADRÃO (migração 062): valem por
 * cima do foco do código, e só onde o lugar continua com a foto padrão — foto
 * trocada traz o foco da própria linha, que o admin marcou olhando para ela.
 */
export function mesclarFotosDaHome(
  padrao: FotosDaHome,
  linhas: readonly LinhaFotoDaHome[],
  focos: readonly LinhaFocoDaHome[] = [],
): FotosDaHome {
  const fotos: FotosDaHome = { ...padrao };
  const trocados = new Set<string>();
  for (const l of linhas) {
    if (!ehLugarDaHome(l.lugar)) continue;
    if (!dimensaoValida(l.largura) || !dimensaoValida(l.altura)) continue;
    if (!ehChaveDaFotoDaHome(l.chave, l.lugar, "foto")) continue;
    const foto: FotoDemo = {
      src: urlDaFotoDaHome(l.lugar, l.chave, "foto"),
      miniatura: ehChaveDaFotoDaHome(l.chave_miniatura, l.lugar, "miniatura")
        ? urlDaFotoDaHome(l.lugar, l.chave_miniatura, "miniatura")
        : undefined,
      largura: l.largura,
      altura: l.altura,
      descricao: normalizarDescricao(l.descricao),
      focoX: normalizarFoco(l.foco_x),
      focoY: normalizarFoco(l.foco_y),
    };
    fotos[l.lugar] = foto;
    trocados.add(l.lugar);
  }
  for (const f of focos) {
    if (!ehLugarDaHome(f.lugar) || trocados.has(f.lugar)) continue;
    fotos[f.lugar] = { ...fotos[f.lugar], focoX: normalizarFoco(f.foco_x), focoY: normalizarFoco(f.foco_y) };
  }
  return fotos;
}
