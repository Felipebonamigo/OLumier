import type { Ciclo } from "./planos";

/**
 * AUMENTAR O PLANO NO MEIO DO PERÍODO — quanto cobrar, sem banco e sem rede.
 *
 * ── O QUE FOI PEDIDO (28/09/2026) ─────────────────────────────────────────
 *
 * Felipe: "se o usuário quiser aumentar o pacote da galeria, não cobre
 * novamente, apenas a diferença".
 *
 * Até aqui a troca mudava o valor da assinatura e mais nada: o período já pago
 * seguia sem cobrança nenhuma, e o preço novo só entrava na fatura seguinte.
 * Ninguém pagava duas vezes — mas a diferença também não era cobrada, e no
 * anual isso é até um ano de espaço maior pelo preço do menor.
 *
 * A regra agora:
 *
 *   · Subiu de plano → cobra SÓ a diferença entre o plano novo e o que já foi
 *     pago, proporcional ao que falta do período. O espaço vale na hora; da
 *     próxima fatura em diante, o preço novo.
 *   · Desceu → nada volta, e o preço menor vale da próxima fatura.
 *   · Desceu e subiu de novo no mesmo período → a base é o maior plano já pago
 *     no período (`tenants.plano_do_periodo`), então não se cobra de novo o que
 *     já foi pago.
 *   · Nada pago ainda (teste grátis, fatura em aberto) → não há diferença: a
 *     fatura que está para vencer já sai com o preço novo.
 *   · Diferença abaixo de R$ 5,00 fica por nossa conta: é o mínimo que o Asaas
 *     aceita numa cobrança, e cobrar centavos custaria mais em taxa que o valor.
 */

/** O mínimo de uma cobrança no Asaas. Abaixo disso, a diferença não é cobrada. */
export const MINIMO_DA_DIFERENCA_CENTAVOS = 500;

export interface CotacaoDaTroca {
  /** "subida" só quando o plano novo custa mais que o já pago no período. */
  tipo: "subida" | "descida";
  /** A diferença proporcional, em centavos. Zero quando não há o que cobrar. */
  diferencaCentavos: number;
  /** Se a diferença vira cobrança (acima do mínimo). */
  cobrar: boolean;
  /** Até quando vai o período pago que a diferença completa. */
  ate: Date | null;
  /** Quanto do período ainda falta, de 0 a 1. */
  fracao: number;
  /** O mesmo, em meses — é o que a reserva do split usa. */
  mesesRestantes: number;
}

const mesesDoCiclo = (ciclo: Ciclo) => (ciclo === "anual" ? 12 : 1);

/**
 * A cotação da troca.
 *
 * `precoBaseCentavos` é o do plano já pago no período e `precoNovoCentavos` o
 * do plano escolhido, os dois no preço do CICLO (o anual já é dez meses) e com
 * o mesmo combo — a diferença é só a dos planos. `fimDoPeriodo` é até quando o
 * dinheiro já pago cobre (null = nada pago).
 *
 * O período conta para trás a partir do fim, pelo calendário: um mês de
 * setembro tem 30 dias, um de outubro 31, e o anual inteiro é o ano.
 */
export function cotarDiferenca(dados: {
  precoBaseCentavos: number;
  precoNovoCentavos: number;
  ciclo: Ciclo;
  agora: Date;
  fimDoPeriodo: Date | null;
}): CotacaoDaTroca {
  const { precoBaseCentavos, precoNovoCentavos, ciclo, agora, fimDoPeriodo } = dados;
  const tipo = precoNovoCentavos > precoBaseCentavos ? "subida" : "descida";
  const nada: CotacaoDaTroca = { tipo, diferencaCentavos: 0, cobrar: false, ate: fimDoPeriodo, fracao: 0, mesesRestantes: 0 };
  if (tipo === "descida" || !fimDoPeriodo) return nada;

  const inicio = new Date(fimDoPeriodo.getTime());
  inicio.setMonth(inicio.getMonth() - mesesDoCiclo(ciclo));
  const total = fimDoPeriodo.getTime() - inicio.getTime();
  const falta = fimDoPeriodo.getTime() - agora.getTime();
  if (falta <= 0 || total <= 0) return nada;

  const fracao = Math.min(1, falta / total);
  const diferencaCentavos = Math.round((precoNovoCentavos - precoBaseCentavos) * fracao);
  return {
    tipo,
    diferencaCentavos,
    cobrar: diferencaCentavos >= MINIMO_DA_DIFERENCA_CENTAVOS,
    ate: fimDoPeriodo,
    fracao,
    mesesRestantes: fracao * mesesDoCiclo(ciclo),
  };
}

/**
 * Até quando o dinheiro já pago cobre, para a conta da diferença.
 *
 * É o MENOR entre dois fins: `pago_ate` (o período contado do pagamento, ver
 * `fimDoPeriodoPago`) e o vencimento da próxima fatura, que é onde o preço
 * novo passa a valer. Os dois costumam coincidir; não coincidem quando o
 * pagamento atrasou uns dias — aí `pago_ate` passa do vencimento seguinte, e
 * cobrar até ele seria cobrar em dobro os dias que a próxima fatura já cobre.
 *
 * Fatura vencida e não paga puxa o fim para trás do "agora": não há diferença,
 * porque a própria fatura em aberto já passa ao preço novo.
 */
export function fimDoPeriodoParaDiferenca(
  pagoAte: Date | null,
  proximoVencimento: Date | null,
  agora: Date,
): Date | null {
  if (!pagoAte || pagoAte.getTime() <= agora.getTime()) return null;
  if (!proximoVencimento) return pagoAte;
  return proximoVencimento.getTime() < pagoAte.getTime() ? proximoVencimento : pagoAte;
}

/** "2026-10-10" do Asaas como o começo daquele dia em Brasília. */
export function dataDoAsaas(dia: string | null | undefined): Date | null {
  if (!dia || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  return new Date(`${dia}T00:00:00-03:00`);
}

/** O dia de hoje (ou de `quando`) em Brasília, no formato do Asaas. */
export function diaDeBrasilia(quando: Date = new Date(), somarDias = 0): string {
  const d = new Date(quando.getTime() + somarDias * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
