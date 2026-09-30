import "server-only";
import { consultar, consultarUm } from "./db";
import { asaasConfigurado, ultimaCobrancaPaga } from "./asaas";
import { alertarUmaPessoa } from "./testes-abandonados";
import type { Tenant } from "./tenants";
import { cicloDe, formatarReais } from "@/config/planos";
import { cotarDevolucao, type CotacaoDaDevolucao } from "@/config/devolucao";

/**
 * A devolução ao cancelar — a parte que fala com o Asaas e com o banco.
 *
 * A regra é `config/devolucao.ts`. Aqui mora o resto: de qual cobrança sai o
 * valor, onde a dívida fica anotada, e quem é avisado.
 *
 * ── O ESTORNO NÃO É AUTOMÁTICO, DE PROPÓSITO ──────────────────────────────
 *
 * A cobrança tem split para os três sócios. Estorno parcial de cobrança com
 * split nunca foi ensaiado contra o Asaas, e errar aqui é dinheiro saindo da
 * carteira de quem não devia. Então o pedido vira uma linha em `devolucoes`,
 * uma pessoa recebe o alerta com o id da cobrança e o valor, e estorna no
 * painel do Asaas. O webhook dessa cobrança (`marcarDevolucaoFeita`) fecha a
 * linha. Os Termos prometem o prazo que isso cabe: `PRAZO_DA_DEVOLUCAO`.
 */

/** O prazo prometido nos Termos e na tela de Conta. */
export const PRAZO_DA_DEVOLUCAO = "5 dias úteis";

export interface CotacaoDoCancelamento extends CotacaoDaDevolucao {
  cobrancaId: string | null;
}

/**
 * Quanto voltaria se a conta cancelasse agora. Sem assinatura, sem cobrança
 * ligada ou sem pagamento: nada — e isso nunca é erro, porque cancelar sem
 * devolução continua possível.
 */
export async function cotarCancelamento(
  tenant: Pick<Tenant, "asaas_assinatura_id" | "ciclo_cobranca" | "pago_ate">,
  agora: Date = new Date(),
): Promise<CotacaoDoCancelamento> {
  const nada = (): CotacaoDoCancelamento => ({
    ...cotarDevolucao({ pagoCentavos: 0, ciclo: cicloDe(tenant.ciclo_cobranca), fimDoPeriodo: null, agora }),
    cobrancaId: null,
  });
  if (!tenant.asaas_assinatura_id || !asaasConfigurado()) return nada();

  const cobranca = await ultimaCobrancaPaga(tenant.asaas_assinatura_id);
  if (!cobranca) return nada();

  return {
    ...cotarDevolucao({
      pagoCentavos: cobranca.centavos,
      ciclo: cicloDe(tenant.ciclo_cobranca),
      fimDoPeriodo: tenant.pago_ate ? new Date(tenant.pago_ate) : null,
      agora,
    }),
    cobrancaId: cobranca.id,
  };
}

/**
 * Anota a devolução e chama uma pessoa. Devolve `false` se a cobrança já tinha
 * devolução anotada — cancelar duas vezes não devolve em dobro.
 */
export async function anotarDevolucao(dados: {
  tenantId: string;
  estudio: string;
  cobrancaId: string;
  centavos: number;
  regra: "arrependimento" | "proporcional";
}): Promise<boolean> {
  const nova = await consultarUm<{ id: string }>(
    `insert into devolucoes (tenant_id, cobranca_asaas_id, valor_centavos, regra)
     values ($1, $2, $3, $4)
     on conflict (cobranca_asaas_id) do nothing
     returning id`,
    [dados.tenantId, dados.cobrancaId, dados.centavos, dados.regra],
  );
  if (!nova) return false;

  await alertarUmaPessoa(
    `devolução a fazer: ${formatarReais(dados.centavos)} para ${dados.estudio}`,
    "Devolução a fazer",
    [
      `${dados.estudio} cancelou a assinatura e pediu a devolução.`,
      "",
      `  valor:    ${formatarReais(dados.centavos)}`,
      `  regra:    ${dados.regra === "arrependimento" ? "arrependimento (até 7 dias: tudo)" : "proporcional (pago menos os meses começados)"}`,
      `  cobrança: ${dados.cobrancaId}`,
      "",
      `Estornar ESSE valor dessa cobrança no painel do Asaas, em até ${PRAZO_DA_DEVOLUCAO}.`,
      "O aviso de estorno do Asaas fecha a pendência sozinho.",
    ].join("\n"),
  );
  return true;
}

/** O webhook avisou que a cobrança foi estornada: a devolução está feita. */
export async function marcarDevolucaoFeita(cobrancaId: string): Promise<boolean> {
  const r = await consultar<{ id: string }>(
    `update devolucoes set feita_em = now()
      where cobranca_asaas_id = $1 and feita_em is null
      returning id`,
    [cobrancaId],
  );
  return r.length > 0;
}

export interface DevolucaoPendente {
  id: string;
  tenant_id: string;
  nome_estudio: string;
  cobranca_asaas_id: string;
  valor_centavos: number;
  regra: string;
  pedida_em: Date;
}

export async function devolucoesPendentes(): Promise<DevolucaoPendente[]> {
  return consultar<DevolucaoPendente>(
    `select d.id, d.tenant_id, t.nome_estudio, d.cobranca_asaas_id, d.valor_centavos, d.regra, d.pedida_em
       from devolucoes d
       join tenants t on t.id = d.tenant_id
      where d.feita_em is null
      order by d.pedida_em`,
  );
}
