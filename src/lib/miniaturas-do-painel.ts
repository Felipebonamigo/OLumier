/**
 * AS MINIATURAS DA ABA FOTOS: PEDIDAS AOS POUCOS, E GUARDADAS (01/10/2026).
 *
 * Juan, subindo fotos em vários capítulos de uma galeria grande: "tá tudo bem
 * lagado agora… tá com bastante lag, não tá nem subindo as fotos. Cada
 * exclusão / criação de um capítulo novo tá…". As galerias dele chegam a 4.577
 * arquivos.
 *
 * Medido numa galeria de 3.000 fotos, com a rede de quem está em Portland com
 * VPN (8 Mbps, 180 ms): criar um capítulo levava 3 s para aparecer e baixava
 * de 1,4 a 3,2 MB. Duas razões moravam aqui:
 *
 *  - a página mandava os 3.000 endereços assinados em TODA volta do servidor
 *    — 1,4 MB dos 2 MB de dados —, e cada volta assinava todos de novo;
 *  - endereço novo é imagem nova para o navegador: cada capítulo criado
 *    rebaixava as miniaturas que estavam na tela (de 14 a 96, conforme a
 *    janela).
 *
 * Agora o servidor manda o endereço só da primeira tela, e o resto é pedido em
 * lote quando o ladrilho chega perto da tela (`/api/galerias/[id]/miniaturas`).
 * O endereço fica guardado AQUI, fora do React, por 45 minutos — a assinatura
 * vale uma hora. Volta nenhuma do servidor troca o que já está desenhado, e o
 * navegador não baixa de novo o que já tem.
 *
 * ── QUANDO O GUARDADO NÃO SERVE MAIS ──────────────────────────────────────
 *
 * A chave tem a `versao` da mídia (sobe quando o Lightroom republica a foto
 * na MESMA chave do armazém) e se ela tem capa: vídeo que ganha capa passa a
 * mostrar outra imagem. Trocar a capa de um vídeo que já tinha uma não muda
 * nenhum dos dois, e por isso a tela da capa chama `esquecerMiniaturasDe`.
 *
 * Fica fora do componente de propósito: sobrevive à navegação entre as abas
 * da galeria, e cada ladrilho ouve só a sua chave — chegar o endereço de uma
 * foto redesenha aquela foto, e não as 4.577.
 */

export interface EnderecoDaMiniatura {
  url: string;
  /** O filme, em vídeo: o `src` do `<video>`, enquanto `url` é a capa. */
  urlFilme?: string;
}

interface Guardado extends EnderecoDaMiniatura {
  desde: number;
}

/** A assinatura vale 1 h (`3600` na rota e na página); sobra folga para baixar. */
export const VALE_MS = 45 * 60_000;
/** Ids por pedido. A rota recusa mais que isto. */
export const LOTE_DE_MINIATURAS = 200;
const TENTATIVAS = 3;

const guardados = new Map<string, Guardado>();
const ouvintes = new Map<string, Set<() => void>>();

export function chaveDaMiniatura(m: { id: string; versao: number; temCapa?: boolean }): string {
  return `${m.id}:${m.versao}:${m.temCapa ? 1 : 0}`;
}

const fresco = (g: Guardado | undefined, agora: number) => Boolean(g && agora - g.desde < VALE_MS);

function avisar(chave: string) {
  for (const fn of ouvintes.get(chave) ?? []) fn();
}

/** O guardado, mesmo vencido: imagem já desenhada não precisa de endereço novo. */
export function lerMiniatura(chave: string): EnderecoDaMiniatura | undefined {
  return guardados.get(chave);
}

export function ouvirMiniatura(chave: string, fn: () => void): () => void {
  let daChave = ouvintes.get(chave);
  if (!daChave) ouvintes.set(chave, (daChave = new Set()));
  daChave.add(fn);
  return () => {
    daChave.delete(fn);
    if (daChave.size === 0) ouvintes.delete(chave);
  };
}

/** Guarda — a não ser que já haja um guardado ainda válido, que é o que fica. */
export function guardarMiniatura(chave: string, e: EnderecoDaMiniatura, agora = Date.now()): void {
  if (fresco(guardados.get(chave), agora)) return;
  guardados.set(chave, { ...e, desde: agora });
  avisar(chave);
}

export function esquecerMiniaturasDe(mediaId: string): void {
  for (const chave of [...guardados.keys()]) {
    if (chave.startsWith(`${mediaId}:`)) {
      guardados.delete(chave);
      avisar(chave);
    }
  }
}

/* ── PEDIDOS EM LOTE ──────────────────────────────────────────────────────
 * Uma rolada põe dezenas de ladrilhos perto da tela no mesmo instante; cada
 * um pede, e o que sai é UM pedido por galeria a cada 30 ms. */
const fila = new Map<string, Map<string, string>>(); // galeria → (id → chave)
const emVoo = new Set<string>();
const falhas = new Map<string, number>();
let agendado = false;

export function pedirMiniatura(galeriaId: string, id: string, chave: string): void {
  if (fresco(guardados.get(chave), Date.now()) || emVoo.has(chave)) return;
  if ((falhas.get(chave) ?? 0) >= TENTATIVAS) return;
  emVoo.add(chave);
  let daGaleria = fila.get(galeriaId);
  if (!daGaleria) fila.set(galeriaId, (daGaleria = new Map()));
  daGaleria.set(id, chave);
  if (!agendado) {
    agendado = true;
    setTimeout(despachar, 30);
  }
}

function despachar() {
  agendado = false;
  const lotes = [...fila];
  fila.clear();
  for (const [galeriaId, porId] of lotes) {
    const todos = [...porId];
    for (let i = 0; i < todos.length; i += LOTE_DE_MINIATURAS) {
      void buscar(galeriaId, todos.slice(i, i + LOTE_DE_MINIATURAS));
    }
  }
}

async function buscar(galeriaId: string, parte: [string, string][]) {
  let enderecos: Record<string, EnderecoDaMiniatura> | null = null;
  try {
    const r = await fetch(`/api/galerias/${galeriaId}/miniaturas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: parte.map(([id]) => id) }),
    });
    if (r.ok) enderecos = ((await r.json()) as { enderecos: Record<string, EnderecoDaMiniatura> }).enderecos;
  } catch {
    /* sem rede: tenta de novo logo abaixo */
  }
  for (const [, chave] of parte) emVoo.delete(chave);
  if (enderecos) {
    const agora = Date.now();
    for (const [id, chave] of parte) {
      falhas.delete(chave);
      const e = enderecos[id];
      if (e) guardarMiniatura(chave, e, agora);
    }
    return;
  }
  /* Falhou o lote inteiro (rede, servidor reiniciando): o ladrilho continua
     na tela e não vai "aparecer" de novo para pedir. Três tentativas,
     espaçadas, e depois desiste — recarregar a página recomeça. */
  for (const [, chave] of parte) falhas.set(chave, (falhas.get(chave) ?? 0) + 1);
  setTimeout(() => {
    for (const [id, chave] of parte) pedirMiniatura(galeriaId, id, chave);
  }, 2000);
}

/* ── QUEM ESTÁ PERTO DA TELA ──────────────────────────────────────────────
 * Um observador só para a grade inteira. A margem pede uma tela e meia antes:
 * quem rola rápido encontra a miniatura já a caminho. Observa o `<li>`, e não
 * a imagem: o ladrilho tem `content-visibility: auto`, e o que mora DENTRO
 * dele fora da tela nem é diagramado. */
let observador: IntersectionObserver | null = null;
const aoAparecer = new Map<Element, () => void>();

export function observarMiniatura(el: Element, fn: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    fn();
    return () => {};
  }
  observador ??= new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) if (e.isIntersecting) aoAparecer.get(e.target)?.();
    },
    { rootMargin: "1500px 0px" },
  );
  aoAparecer.set(el, fn);
  observador.observe(el);
  return () => {
    observador?.unobserve(el);
    aoAparecer.delete(el);
  };
}
