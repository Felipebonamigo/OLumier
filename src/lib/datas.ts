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

/**
 * Como o banco entrega uma coluna `date`: MEIO-DIA UTC daquele dia.
 *
 * ── O DEFEITO QUE ISTO FECHA (30/09/2026) ─────────────────────────────────
 *
 * Julia Flores: "se eu quero dia 26 ele aparece na capa dia 25". O driver
 * entregava meia-noite no fuso do PROCESSO — no VPS, UTC: 26/09 00:00 UTC. Na
 * véspera, toda data da tela passou a sair em Brasília (`config/fuso.ts`), e
 * 00:00 UTC é 21:00 do dia 25 lá. Com o processo em Brasília (a máquina de
 * quem desenvolve), o defeito some — por isso ele passou.
 *
 * Meio-dia UTC é o mesmo dia do calendário em qualquer fuso de −11 h a +11 h:
 * na tela em Brasília (09:00), no formulário pelos campos locais
 * (`paraCampoDeData`, com o processo em UTC, em Brasília ou em Tóquio) e no
 * navegador de quem estiver viajando. A coluna continua `date`; só muda o
 * instante que a representa aqui dentro. `scripts/testar-data-do-evento.mjs`.
 */
export function diaDoBanco(texto: string): Date {
  return new Date(`${texto}T12:00:00Z`);
}
