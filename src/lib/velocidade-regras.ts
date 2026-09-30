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

/** Uma medida como o navegador manda. Peneirada antes de virar linha. */
export interface MedidaDeEnvio {
  galeriaId: string | null;
  bytes: number;
  ms: number | null;
  ok: boolean;
  erro: string | null;
}

export const LOTE_MAXIMO_DE_MEDIDAS = 100;

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
    });
  }
  return saida.length ? saida : null;
}
