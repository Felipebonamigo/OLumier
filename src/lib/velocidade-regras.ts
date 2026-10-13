/**
 * A VELOCIDADE REAL — as contas, sem banco (30/09/2026).
 *
 * Felipe: "temos que ter velocidade e funcionar". Para isso é preciso VER a
 * velocidade que os clientes estão tendo, e não o palpite de quem testou uma
 * vez. Este arquivo resume amostras (bytes e milissegundos) em números que
 * cabem num cartão; `lib/velocidade.ts` busca as amostras.
 *
 * Pura: `scripts/testar-velocidade.mjs` cobre sem servidor.
 */

export interface Amostra {
  bytes: number;
  ms: number;
}

export interface ResumoDeVelocidade {
  /** Quantas amostras valeram. */
  n: number;
  /** Bytes por segundo. */
  mediana: number;
  /** Os 10% mais lentos estão abaixo disto. */
  p10: number;
}

/*
 * Amostra pequena demais mede a ida e volta, não a banda: um arquivo de 200 KB
 * leva o tempo do "alô" e sai com uma velocidade ridícula que não diz nada da
 * rede. Quem chama diz o piso adequado ao que mede.
 */
export function resumoDeVelocidade(amostras: Amostra[], bytesMinimo = 0): ResumoDeVelocidade | null {
  const taxas = amostras
    .filter((a) => a.bytes >= bytesMinimo && a.ms >= 200)
    .map((a) => (a.bytes / a.ms) * 1000)
    .sort((a, b) => a - b);
  if (taxas.length === 0) return null;
  const quantil = (q: number) => taxas[Math.min(taxas.length - 1, Math.floor(q * taxas.length))];
  return { n: taxas.length, mediana: quantil(0.5), p10: quantil(0.1) };
}

/** "3,4 MB/s", "450 KB/s" — do jeito que o navegador mostra no download. */
export function formatarVelocidade(bytesPorSegundo: number): string {
  if (bytesPorSegundo >= 1024 * 1024) {
    return `${(bytesPorSegundo / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB/s`;
  }
  return `${Math.round(bytesPorSegundo / 1024).toLocaleString("pt-BR")} KB/s`;
}

/**
 * "Safari · macOS", "Chrome · Windows" — o bastante para ver um padrão numa
 * lista de falhas ("todas no Safari?"), sem guardar o user-agent inteiro.
 */
export function navegadorResumido(ua: string | null | undefined): string {
  if (!ua) return "desconhecido";
  const nav = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /(Chrome|CriOS)\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "outro";
  const so = /iPhone|iPad/.test(ua)
    ? "iPhone/iPad"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "outro";
  return `${nav} · ${so}`;
}

/**
 * ONDE O TEMPO DE UMA FOTO VAI (13/10/2026, migração 075).
 *
 * `ms` de cada medida é só o PUT do original. Na Melannie, 8,8 GB, esse PUT
 * ocupou 43% do tempo das seis vagas da fila — e os outros 57% não tinham
 * dono. Cada campo é o tempo, em ms, de uma etapa da tentativa que deu certo;
 * `null` é "não medi" (navegador antigo, ou etapa que o arquivo não tem).
 */
export interface EtapasDoEnvio {
  /** Esperando a vez do processador de miniaturas (`MINIATURAS_JUNTAS`). */
  esperaMs: number | null;
  /** Decodificar a foto e gerar miniatura, preview e EXIF. */
  miniaturaMs: number | null;
  /** O pedido que reserva o arquivo e assina o envio. */
  preparoMs: number | null;
  /** O que as miniaturas ainda demoraram depois de o original chegar. */
  derivadasMs: number | null;
  /** O servidor conferindo que o arquivo chegou. */
  confirmarMs: number | null;
  /** Da vaga ocupada ao fim, com todas as tentativas e as esperas entre elas. */
  totalMs: number | null;
  /** Quantas vezes o arquivo foi tentado; 1 é "de primeira". */
  tentativas: number | null;
  /** O navegador ficou sem rede em algum momento do arquivo. */
  semRede: boolean | null;
}

export const SEM_ETAPAS: EtapasDoEnvio = {
  esperaMs: null,
  miniaturaMs: null,
  preparoMs: null,
  derivadasMs: null,
  confirmarMs: null,
  totalMs: null,
  tentativas: null,
  semRede: null,
};

/** Uma medida como o navegador manda. Peneirada antes de virar linha. */
export interface MedidaDeEnvio {
  galeriaId: string | null;
  bytes: number;
  ms: number | null;
  ok: boolean;
  erro: string | null;
  /**
   * O SERVIDOR recusou (espaço do plano, teste vencido, sessão, tipo de
   * arquivo) — não foi a rede. Só vale em falha. Ver a migração 069: sem esta
   * marca, um estúdio no teto dos 10 GB virava 150 "desistências" no painel.
   */
  recusa: boolean;
  etapas: EtapasDoEnvio;
}

export const LOTE_MAXIMO_DE_MEDIDAS = 100;

/* Um dia de relógio: mais que isso numa etapa de UM arquivo é relógio quebrado
   (o computador dormiu, a aba ficou escondida), e uma média com ele dentro diz
   o que ninguém viveu. */
const TETO_DE_ETAPA_MS = 24 * 60 * 60 * 1000;

/** O que o navegador mandou, peneirado; qualquer lixo vira "não medi". */
export function lerEtapas(bruto: unknown): EtapasDoEnvio {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return SEM_ETAPAS;
  const o = bruto as Record<string, unknown>;
  const ms = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= TETO_DE_ETAPA_MS ? Math.round(n) : null;
  };
  const tentativas = Number(o.tentativas);
  return {
    esperaMs: ms(o.esperaMs),
    miniaturaMs: ms(o.miniaturaMs),
    preparoMs: ms(o.preparoMs),
    derivadasMs: ms(o.derivadasMs),
    confirmarMs: ms(o.confirmarMs),
    totalMs: ms(o.totalMs),
    tentativas: Number.isFinite(tentativas) && tentativas >= 1 && tentativas <= 100 ? Math.round(tentativas) : null,
    semRede: typeof o.semRede === "boolean" ? o.semRede : null,
  };
}

/**
 * "0,4 s", "12 s", "1 min 5 s" — o tempo de uma etapa para a tela do admin.
 * Abaixo de 10 s mostra a casa decimal, porque é ali que as etapas se parecem.
 */
export function formatarDuracaoCurta(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = ms / 1000;
  if (s < 10) return `${s.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
  if (s < 60) return `${Math.round(s)} s`;
  const min = Math.floor(s / 60);
  const resto = Math.round(s - min * 60);
  return resto === 60 ? `${min + 1} min` : resto === 0 ? `${min} min` : `${min} min ${resto} s`;
}

/**
 * O que sobra do tempo total depois de descontar as etapas medidas: tentativas
 * refeitas, esperas entre elas e o que ninguém cronometrou. Nunca negativo — a
 * soma das etapas pode passar do total por arredondamento.
 */
export function tempoPerdido(total: number | null, etapas: (number | null)[]): number | null {
  if (total === null) return null;
  const medido = etapas.reduce<number>((soma, e) => soma + (e ?? 0), 0);
  return Math.max(0, total - medido);
}

/** Lixo vira `null`; o que sobra entra. Texto de erro com teto — é da tela, não um log. */
export function lerMedidas(bruto: unknown): MedidaDeEnvio[] | null {
  if (!Array.isArray(bruto) || bruto.length === 0 || bruto.length > LOTE_MAXIMO_DE_MEDIDAS) return null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const saida: MedidaDeEnvio[] = [];
  for (const m of bruto) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const bytes = Number(o.bytes);
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > 1e13) continue;
    const ok = o.ok === true;
    const ms = ok && Number.isFinite(Number(o.ms)) && Number(o.ms) >= 0 ? Math.min(2 ** 31 - 1, Math.round(Number(o.ms))) : null;
    saida.push({
      galeriaId: typeof o.galeriaId === "string" && uuid.test(o.galeriaId) ? o.galeriaId : null,
      bytes: Math.round(bytes),
      ms,
      ok,
      erro: !ok && typeof o.erro === "string" ? o.erro.slice(0, 200) : null,
      recusa: !ok && o.recusa === true,
      etapas: lerEtapas(o.etapas),
    });
  }
  return saida.length ? saida : null;
}

/**
 * A LEVA — a fila inteira, do primeiro ao último arquivo (09/10/2026).
 *
 * A medida de cada arquivo cronometra só o PUT do original, com outros
 * subindo junto: 3 MB/s por arquivo pode ser a internet inteira do fotógrafo
 * ocupada, e daquele número não dá para saber. A leva mede o que ele sente —
 * "a pasta levou quanto?" — com miniatura, preparo, confirmação e retentativa
 * dentro. Ver a migração 069.
 */
export interface MedidaDeLeva {
  /** Só o que subiu. */
  bytes: number;
  /** Relógio de parede, do começo da fila até ela secar. */
  ms: number;
  arquivos: number;
  /** Desistências de rede; recusa do servidor não conta. */
  falhas: number;
  paralelos: number;
}

/** Lixo vira `null`. Leva sem arquivo enviado não mede nada. */
export function lerLeva(bruto: unknown): MedidaDeLeva | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const o = bruto as Record<string, unknown>;
  const inteiro = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
  };
  const bytes = inteiro(o.bytes, 1, 1e14);
  const ms = inteiro(o.ms, 1, 2 ** 31 - 1);
  const arquivos = inteiro(o.arquivos, 1, 1_000_000);
  const falhas = inteiro(o.falhas ?? 0, 0, 1_000_000);
  const paralelos = inteiro(o.paralelos, 1, 64);
  if (bytes === null || ms === null || arquivos === null || falhas === null || paralelos === null) return null;
  return { bytes, ms, arquivos, falhas, paralelos };
}
