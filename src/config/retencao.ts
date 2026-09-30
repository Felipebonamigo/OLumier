/**
 * Quanto tempo a conta encerrada guarda o que entregou.
 *
 * Decisão do Felipe, 30/09/2026: "3 meses, mas colocando vários avisos".
 * Cancelada ou inadimplente, a conta continua com as galerias no ar por
 * `DIAS_DE_RETENCAO` dias depois do fim do período pago; o primeiro aviso sai
 * no dia em que o período acaba, e os outros a `AVISOS_ANTES_DE_APAGAR` dias da
 * data. Depois disso, os arquivos são apagados.
 *
 * Arquivo PURO, e separado de `lib/contas-encerradas.ts`, porque o número
 * aparece em tela (Conta, a home, os Termos) e numa rotina de servidor — e
 * texto que diz "3 meses" com a rotina contando outra coisa é o tipo de
 * contradição que vira processo.
 */
export const DIAS_DE_RETENCAO = 90;

/** Os avisos depois do primeiro, em dias antes da data de apagar. */
export const AVISOS_ANTES_DE_APAGAR = [30, 7, 1] as const;

/** O primeiro aviso mais os de `AVISOS_ANTES_DE_APAGAR`. */
export const TOTAL_DE_AVISOS = 1 + AVISOS_ANTES_DE_APAGAR.length;

/** Para texto: "3 meses". */
export const RETENCAO_POR_EXTENSO = "3 meses";
