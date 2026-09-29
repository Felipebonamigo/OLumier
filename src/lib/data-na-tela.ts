import { FUSO } from "@/config/fuso";

/**
 * As datas como o painel as mostra — sempre em horário de Brasília.
 *
 * ── POR QUE ISTO SAIU DE `admin-pecas.tsx` (29/09/2026) ───────────────────
 *
 * Porque são funções puras, e estavam num arquivo de COMPONENTES. A diferença
 * apareceu na hora de prendê-las num teste: o carregador de TypeScript da suíte
 * não abre `.tsx`, então a regra mais cara do produto — a data que o cliente lê
 * — era a única que não dava para conferir sem subir o servidor.
 *
 * `admin-pecas.tsx` reexporta as duas, então nenhuma tela precisou mudar.
 *
 * O porquê do fuso está em `config/fuso.ts`. Resumo: o VPS roda em UTC, a
 * página é desenhada no servidor, e "pt-BR" escolhe o idioma, nunca o fuso.
 */
const DATA = { day: "2-digit", month: "short", year: "numeric" } as const;

/** Data curta, ou travessão. Uma função só, para o painel inteiro falar igual. */
export function data(d: Date | string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString("pt-BR", { ...DATA, timeZone: FUSO }) : "—";
}

/** Data com hora — para o log de auditoria, onde a hora é o que se procura. */
export function dataHora(d: Date | string | null | undefined): string {
  return d
    ? new Date(d).toLocaleString("pt-BR", {
        ...DATA,
        hour: "2-digit",
        minute: "2-digit",
        timeZone: FUSO,
      })
    : "—";
}
