/**
 * AS REGRAS DO FECHAMENTO MENSAL, sem banco e sem relógio próprio.
 *
 * Puro de propósito, como `lib/bio-regras.ts`: o teste exercita estas funções
 * direto, e a página e o temporizador usam as mesmas — a regra que o teste prende
 * é a que roda. O porquê da tabela está na migração 068.
 */
import { mesDeBrasilia } from "./caixa-dos-socios";
import type { EstudioParaMetrica, ResumoDaPlataforma } from "./metricas-admin";

/* O mês de Brasília ("AAAA-MM") é o do Caixa dos sócios — o mesmo, para a tabela
   e o Caixa não discordarem sobre em que mês caiu uma data. */
export { mesDeBrasilia };

/** Os últimos `quantos` meses terminando em `ate`, do mais novo para o mais antigo. */
export function mesesAte(ate: string, quantos: number): string[] {
  const [a, m] = ate.split("-").map(Number);
  return Array.from({ length: quantos }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** Os números de um mês — o que a tabela guarda e o que a tela mostra, na mesma forma. */
export interface NumerosDoFechamento {
  estudios: number;
  novos: number;
  pagando: number;
  emTeste: number;
  inadimplentes: number;
  cancelados: number;
  cortesias: number;
  bytesGuardados: bigint;
  receitaCentavos: number;
  custoGuardadoCentavos: number;
  custoFixoCentavos: number;
  cortesiasCentavos: number;
  resultadoCentavos: number;
}

/**
 * Os números do mês a partir do que a página já tem: a lista dos estúdios e o
 * `resumoDaPlataforma` dela. NÃO recalcula receita nem custo — pega os do
 * resumo, para a linha gravada e o bloco Dinheiro nunca divergirem.
 *
 * `novos` é o único que depende do mês: quantos estúdios nasceram nele (em
 * Brasília), e não "nos últimos 30 dias".
 */
export function numerosDoMes(
  estudios: Pick<EstudioParaMetrica, "criado_em">[],
  resumo: ResumoDaPlataforma,
  mes: string,
  cortesiasCentavos: number,
): NumerosDoFechamento {
  return {
    estudios: resumo.estudios,
    novos: estudios.filter((e) => mesDeBrasilia(new Date(e.criado_em)) === mes).length,
    pagando: resumo.porStatus.ativo,
    emTeste: resumo.porStatus.trial,
    inadimplentes: resumo.porStatus.inadimplente,
    cancelados: resumo.porStatus.cancelado,
    cortesias: resumo.porStatus.cortesia,
    bytesGuardados: resumo.bytesGuardados,
    receitaCentavos: resumo.receitaMensalCentavos,
    custoGuardadoCentavos: resumo.custoMensalCentavos,
    custoFixoCentavos: resumo.custoFixoCentavos,
    cortesiasCentavos,
    resultadoCentavos: resumo.resultadoMensalCentavos,
  };
}

/** Uma linha da tabela "Mês a mês", já com tudo o que a tela precisa. */
export interface LinhaMesAMes {
  mes: string;
  /** Estúdios criados no mês. EXATO em todos os meses: tem data no banco. */
  cadastros: number;
  /** Estúdios criados até o fim do mês (até agora, no mês corrente). EXATO. */
  contasNoFim: number;
  /**
   * Os números gravados, ou null: "sem registro". No mês corrente são os DE
   * AGORA (`aoVivo`), e não o que está gravado — a página mostra o dia, e o
   * temporizador grava a madrugada.
   */
  numeros: NumerosDoFechamento | null;
  aoVivo: boolean;
  /** Quando a linha gravada foi escrita pela última vez; null no vivo e no sem registro. */
  registradoEm: Date | null;
}

/** O que a tabela devolve, antes de virar `NumerosDoFechamento` (bigint, camelCase). */
export interface LinhaGravada {
  mes: string;
  registrado_em: Date;
  estudios: number;
  novos: number;
  pagando: number;
  em_teste: number;
  inadimplentes: number;
  cancelados: number;
  cortesias: number;
  bytes_guardados: string;
  receita_centavos: number;
  custo_guardado_centavos: number;
  custo_fixo_centavos: number;
  cortesias_centavos: number;
  resultado_centavos: number;
}

export function numerosDaLinha(l: LinhaGravada): NumerosDoFechamento {
  return {
    estudios: l.estudios,
    novos: l.novos,
    pagando: l.pagando,
    emTeste: l.em_teste,
    inadimplentes: l.inadimplentes,
    cancelados: l.cancelados,
    cortesias: l.cortesias,
    bytesGuardados: BigInt(l.bytes_guardados),
    receitaCentavos: l.receita_centavos,
    custoGuardadoCentavos: l.custo_guardado_centavos,
    custoFixoCentavos: l.custo_fixo_centavos,
    cortesiasCentavos: l.cortesias_centavos,
    resultadoCentavos: l.resultado_centavos,
  };
}

/**
 * Monta a tabela: os meses do mais novo para o mais antigo, os exatos (cadastros
 * e contas) para todos, e os gravados só onde houver linha.
 *
 * `datas` são os estúdios criados por mês, `antes` quantos existiam antes do
 * primeiro mês da lista — a soma corrida fecha "contas no fim do mês" sem uma
 * consulta por mês.
 */
export function montarMesAMes(
  meses: string[],
  cadastrosPorMes: Record<string, number>,
  existiamAntes: number,
  gravadas: LinhaGravada[],
  vivo: NumerosDoFechamento | null,
  mesAtual: string,
): LinhaMesAMes[] {
  const doMes = new Map(gravadas.map((g) => [g.mes, g]));
  const cronologico = [...meses].sort();
  const acumulado = new Map<string, number>();
  let corrido = existiamAntes;
  for (const mes of cronologico) {
    corrido += cadastrosPorMes[mes] ?? 0;
    acumulado.set(mes, corrido);
  }
  return meses.map((mes) => {
    const aoVivo = mes === mesAtual;
    const gravada = doMes.get(mes) ?? null;
    return {
      mes,
      cadastros: cadastrosPorMes[mes] ?? 0,
      contasNoFim: acumulado.get(mes) ?? 0,
      numeros: aoVivo ? vivo : gravada ? numerosDaLinha(gravada) : null,
      aoVivo,
      registradoEm: aoVivo || !gravada ? null : new Date(gravada.registrado_em),
    };
  });
}
