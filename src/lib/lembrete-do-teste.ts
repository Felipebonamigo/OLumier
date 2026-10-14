import { DIAS_DE_TESTE, quotaEfetivaBytes, TETO_TRIAL_GB } from "@/config/trial";

/**
 * O LEMBRETE DO TESTE — os dois limites, ditos antes de morder.
 *
 * ── DE ONDE VEIO (14/10/2026) ─────────────────────────────────────────────
 *
 * Uma usuária disse que "estava dando erro ao subir galeria". Era o teste que
 * tinha vencido, e ninguém tinha contado a ela que o teste tem DOIS limites:
 * o tempo (14 dias) e o espaço (10 GB). Descobrir um limite no dia em que ele
 * recusa o envio é o pior momento — e quem tem um casamento para entregar
 * descobre na véspera.
 *
 * Regra PURA, como `situacaoDoTenant`: a tela da lista de galerias e o e-mail
 * da madrugada leem a MESMA conta, e o teste a percorre sem banco.
 *
 * ── O QUE CADA LIMITE FAZ ─────────────────────────────────────────────────
 *
 * Tempo só trava quando a cobrança está ligada (sem ela, ninguém teria como
 * assinar — ver `situacaoDoTenant`), então só então o relógio vira aviso. O
 * espaço trava sempre: o teto de 10 GB é regra de `quotaEfetivaBytes`.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

/** Daqui para a frente o tempo vira aviso na tela e e-mail. */
export const DIAS_PARA_AVISAR_TEMPO = 3;
/** A partir daqui o espaço vira aviso na tela e e-mail. */
export const FRACAO_PARA_AVISAR_ESPACO = 0.8;

export type NivelDoTempo = "folgado" | "acabando" | "vencido";
export type NivelDoEspaco = "folgado" | "enchendo" | "cheio";

export interface LembreteDoTeste {
  /** Dias inteiros que faltam (arredondado para cima: "hoje" ainda é 1). 0 = venceu. */
  diasRestantes: number;
  /** Quando o teste termina. */
  terminaEm: Date;
  tempo: NivelDoTempo;
  usadoBytes: bigint;
  tetoBytes: bigint;
  /** 0 a 1. */
  fracaoDoEspaco: number;
  espaco: NivelDoEspaco;
  /** Alguma das duas coisas merece destaque. */
  pedeAtencao: boolean;
}

export interface ContaDoTeste {
  status: string;
  trial_ate: Date | string | null;
  quota_bytes: string;
}

/**
 * O estado dos dois limites, ou `null` quando a conta não está num teste (quem
 * paga, a cortesia, o cancelado) — nada a lembrar.
 */
export function lembreteDoTeste(
  conta: ContaDoTeste,
  usadoBytes: bigint,
  cobrancaLigada: boolean,
  agora: Date = new Date(),
): LembreteDoTeste | null {
  if (conta.status !== "trial" || !conta.trial_ate) return null;
  const fim = new Date(conta.trial_ate);
  if (Number.isNaN(fim.getTime())) return null;

  const restanteMs = fim.getTime() - agora.getTime();
  const diasRestantes = restanteMs <= 0 ? 0 : Math.ceil(restanteMs / DIA_MS);
  const tempo: NivelDoTempo = !cobrancaLigada
    ? "folgado"
    : diasRestantes === 0
      ? "vencido"
      : diasRestantes <= DIAS_PARA_AVISAR_TEMPO
        ? "acabando"
        : "folgado";

  const tetoBytes = quotaEfetivaBytes(conta);
  /* BigInt na conta, número só no fim: 10 GB cabem em Number, mas a quota do
     plano pode ser 10 TB e a divisão não pode perder o centésimo. */
  const fracaoDoEspaco =
    tetoBytes > BigInt(0)
      ? Math.min(1, Number((usadoBytes * BigInt(10_000)) / tetoBytes) / 10_000)
      : 0;
  const espaco: NivelDoEspaco =
    usadoBytes >= tetoBytes && tetoBytes > BigInt(0)
      ? "cheio"
      : fracaoDoEspaco >= FRACAO_PARA_AVISAR_ESPACO
        ? "enchendo"
        : "folgado";

  return {
    diasRestantes,
    terminaEm: fim,
    tempo,
    usadoBytes,
    tetoBytes,
    fracaoDoEspaco,
    espaco,
    pedeAtencao: tempo !== "folgado" || espaco !== "folgado",
  };
}

/** "3 dias", "1 dia", "hoje" — o que falta, em palavras. */
export function faltamPorExtenso(dias: number): string {
  if (dias <= 0) return "terminou";
  if (dias === 1) return "falta 1 dia";
  return `faltam ${dias} dias`;
}

/** A frase única que resume os dois limites, para o topo da tela. */
export const LIMITES_DO_TESTE_POR_EXTENSO = `${DIAS_DE_TESTE} dias e ${TETO_TRIAL_GB} GB`;
