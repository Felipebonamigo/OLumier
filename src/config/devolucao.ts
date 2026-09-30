/**
 * Quanto volta para quem cancela no meio do período pago.
 *
 * ── A REGRA (Felipe, 30/09/2026) ──────────────────────────────────────────
 *
 * 1. Até `DIAS_DE_ARREPENDIMENTO` dias depois do pagamento do período, volta
 *    TUDO. É o direito de arrependimento da compra feita pela internet
 *    (art. 49 do CDC) — vale para o mensal e para o anual, e para renovação
 *    também: a cobrança anual automática que a pessoa esqueceu que viria é
 *    exatamente o caso que acaba no Procon.
 *
 * 2. Depois disso, volta o que foi pago MENOS os meses já começados, cada um
 *    pelo preço mensal que aquele pagamento implica. No anual, o mês vale um
 *    décimo do que foi pago (o anual é dez mensalidades por doze meses, ver
 *    `MESES_PAGOS_NO_ANO`). Quem sai do anual no 3º mês paga três meses cheios
 *    e recebe sete de volta: perde o desconto, não o dinheiro. Do 10º mês em
 *    diante, não sobra nada a devolver — e o acesso continua até o fim.
 *
 *    No mensal a conta dá zero depois do 7º dia, porque o mês começado é o
 *    mês inteiro. A regra é uma só; o mensal é só o caso em que ela dá zero.
 *
 * ── POR QUE O PREÇO SAI DO PAGAMENTO, E NÃO DA TABELA ─────────────────────
 *
 * O preço de tabela pode ter mudado desde o pagamento, e o combo com o
 * Atomatiza baixa o preço de quem tem os dois. Cobrar os meses usados pela
 * tabela de hoje devolveria menos do que é justo a quem pagou com desconto de
 * combo, e mais a quem pagou antes de um aumento. O pagamento é o único número
 * que as duas partes conhecem.
 *
 * ── O QUE NÃO ENTRA ───────────────────────────────────────────────────────
 *
 * A cobrança avulsa da DIFERENÇA de uma troca de plano no meio do período não
 * entra na conta: ela é outra cobrança, e a devolução é da mensalidade (ou
 * anuidade) do período. Se um dia alguém subir de plano e cancelar logo em
 * seguida, a diferença é tratada à mão.
 *
 * Arquivo PURO — a tela de Conta usa para explicar, o servidor para decidir.
 */
import { MESES_PAGOS_NO_ANO, type Ciclo } from "./planos";

export const DIAS_DE_ARREPENDIMENTO = 7;

const DIA_MS = 24 * 60 * 60 * 1000;

export interface CotacaoDaDevolucao {
  /** `nada` quando não há o que devolver — inclusive sem período pago em curso. */
  regra: "arrependimento" | "proporcional" | "nada";
  devolverCentavos: number;
  /** Meses começados do período, contados como inteiros. */
  mesesUsados: number;
  /** O preço de um mês, pelo pagamento. */
  mesCentavos: number;
  inicio: Date | null;
  fim: Date | null;
}

const mesesDoCiclo = (ciclo: Ciclo) => (ciclo === "anual" ? 12 : 1);

function somarMeses(d: Date, meses: number): Date {
  const r = new Date(d.getTime());
  r.setMonth(r.getMonth() + meses);
  return r;
}

export function cotarDevolucao(dados: {
  /** O que foi pago pelo período em curso, em centavos. */
  pagoCentavos: number;
  ciclo: Ciclo;
  /** `pago_ate`: até quando o pagamento cobre. */
  fimDoPeriodo: Date | null;
  agora: Date;
}): CotacaoDaDevolucao {
  const { pagoCentavos, ciclo, fimDoPeriodo, agora } = dados;
  const mesCentavos =
    ciclo === "anual" ? Math.round(pagoCentavos / MESES_PAGOS_NO_ANO) : pagoCentavos;
  const nada: CotacaoDaDevolucao = {
    regra: "nada",
    devolverCentavos: 0,
    mesesUsados: 0,
    mesCentavos,
    inicio: null,
    fim: fimDoPeriodo,
  };
  if (!fimDoPeriodo || pagoCentavos <= 0 || fimDoPeriodo.getTime() <= agora.getTime()) return nada;

  /* O período conta para trás a partir do fim, pelo calendário — igual à
   * diferença da troca de plano (`config/troca-de-plano.ts`). */
  const inicio = somarMeses(fimDoPeriodo, -mesesDoCiclo(ciclo));

  if (agora.getTime() - inicio.getTime() <= DIAS_DE_ARREPENDIMENTO * DIA_MS) {
    return {
      regra: "arrependimento",
      devolverCentavos: pagoCentavos,
      mesesUsados: 0,
      mesCentavos,
      inicio,
      fim: fimDoPeriodo,
    };
  }

  /* Meses começados: o mês em curso conta inteiro. Contado pelo calendário, e
   * não por 30 dias, para "o 3º mês" ser o que a pessoa vê no calendário. */
  let mesesUsados = 1;
  while (
    mesesUsados < mesesDoCiclo(ciclo) &&
    somarMeses(inicio, mesesUsados).getTime() <= agora.getTime()
  ) {
    mesesUsados++;
  }

  const devolverCentavos = Math.max(0, pagoCentavos - mesesUsados * mesCentavos);
  return {
    regra: devolverCentavos > 0 ? "proporcional" : "nada",
    devolverCentavos,
    mesesUsados,
    mesCentavos,
    inicio,
    fim: fimDoPeriodo,
  };
}
