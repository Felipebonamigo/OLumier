/**
 * Como o estúdio vai pagar a mensalidade — e é uma decisão sobre o cartão DELE.
 *
 * Duas formas, e a diferença não é cosmética:
 *
 *   CREDIT_CARD  o cartão é digitado uma vez na fatura do Asaas, fica salvo lá,
 *                e as mensalidades seguintes são capturadas sozinhas. É o que
 *                resolve o "todo mês tenho que ir lá pagar de novo".
 *   UNDEFINED    a fatura abre com Pix, boleto e cartão lado a lado, e a pessoa
 *                paga cada uma na mão. Era o único comportamento até 05/09/2026,
 *                e continua sendo a escolha de quem não tem (ou não quer usar)
 *                cartão de crédito — que no Brasil é muita gente.
 *
 * ── O LADO SEGURO É O DE NÃO VIRAR CARTÃO ─────────────────────────────────
 *
 * O valor chega de um `<form>`, e formulário é o navegador: quem abrir o
 * inspetor troca o campo pelo que quiser. Por isso a lista é fechada e o
 * caminho de erro cai em `UNDEFINED` — deixar lixo virar `CREDIT_CARD` seria o
 * sistema guardando o cartão de quem nunca pediu isso.
 *
 * Repare que a falha aqui é para o lado MENOS automático, e isso é de propósito:
 * ninguém entra em débito automático por acidente; no máximo continua pagando
 * como já pagava. É a mesma direção do resto do projeto (ver `assinatura.ts` e
 * `config/admin.ts`) — na dúvida, o sistema faz menos, não mais.
 *
 * O desenho é o do Atomatiza, que roda isso em produção desde 03/09/2026.
 * `scripts/testar-assinatura-recorrente.mjs` prende as duas pontas.
 */

export type FormaAssinatura = "CREDIT_CARD" | "UNDEFINED";

/**
 * O `value` do botão de cartão no formulário.
 *
 * Constante porque o HTML e a validação precisam concordar — e concordar por
 * acidente não conta: no dia em que o rótulo mudasse, a escolha certa passaria
 * a cair no caminho de erro e ninguém mais conseguiria ligar a cobrança
 * automática, sem nenhum erro aparecer.
 */
export const ESCOLHA_CARTAO = "cartao";

/**
 * Tira acento e caixa antes de comparar.
 *
 * O rótulo sai do nosso próprio HTML, mas HTML se edita — e um "Cartão" com
 * maiúscula ou acento não pode custar a cobrança automática de quem clicou no
 * botão certo.
 */
const simplificar = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Traduz a escolha da tela para o `billingType` do Asaas. */
export function formaDaAssinatura(escolha: unknown): FormaAssinatura {
  if (typeof escolha !== "string") return "UNDEFINED";
  return simplificar(escolha) === ESCOLHA_CARTAO ? "CREDIT_CARD" : "UNDEFINED";
}
