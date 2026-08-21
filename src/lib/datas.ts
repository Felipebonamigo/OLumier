/**
 * Conversões de data que precisam ficar num lugar só.
 *
 * Data de evento é `date` no banco: dia puro, sem hora e sem fuso. Todo bug de
 * "apareceu um dia antes" nasce de tratar isso como instante.
 */

/**
 * Uma data do banco no formato do `<input type="date">` (yyyy-mm-dd).
 *
 * Usa os campos LOCAIS de propósito. O driver do Postgres entrega uma coluna
 * `date` como meia-noite no fuso do processo; passar por `toISOString()` só
 * coincide em fuso negativo. A leste de Greenwich, meia-noite local é o dia
 * anterior em UTC — a data apareceria um dia atrás no formulário e, se a pessoa
 * salvasse sem mexer, seria gravada assim. Um dia perdido a cada edição.
 */
export function paraCampoDeData(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
