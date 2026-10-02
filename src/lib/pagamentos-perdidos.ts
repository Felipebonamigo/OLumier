import "server-only";
import { consultar } from "@/lib/db";
import { asaasConfigurado, ultimaCobrancaPaga } from "@/lib/asaas";
import { pagoAteDepoisDoAviso } from "@/lib/assinatura";
import { recalcularCombo } from "@/lib/combo";
import { avisarPagamento } from "@/lib/aviso-de-pagamento";

/**
 * PAGAMENTOS QUE O WEBHOOK PERDEU — procurados no Asaas e contados aqui.
 *
 * Felipe, 30/09/2026: a Bia Zac pagou a Galeria e o admin continuou dizendo
 * "0 pagantes". O pagamento só existe para nós quando o aviso do Asaas chega
 * ao webhook; se ele não chega (fila do Asaas pausada, servidor reiniciando no
 * meio de uma publicação, token trocado), o dinheiro entra e a conta segue em
 * teste — sem e-mail, sem combo, sem nada. E não havia NADA que percebesse.
 *
 * Isto é a rede embaixo do webhook: para cada estúdio com assinatura, pergunta
 * ao Asaas qual a última cobrança paga e usa a MESMA conta do webhook
 * (`pagoAteDepoisDoAviso`) para saber se ela já foi contada. Cobrança contada
 * não muda nada — rodar isto mil vezes é igual a rodar uma. A que não foi
 * contada é contada agora, com o mesmo efeito do aviso: conta ativa, período
 * pago, combo conferido e o e-mail de pagamento.
 *
 * Roda de hora em hora pelo `ops/fotonio-pagamentos.timer`, e à mão por
 * `scripts/conferir-pagamentos.mjs`.
 */

export interface PagamentoPerdido {
  tenantId: string;
  estudio: string;
  email: string;
  status: string;
  cobrancaId: string;
  valorCentavos: number;
  pagoAteAntes: Date | null;
  pagoAteDepois: Date;
}

/**
 * A MESMA escrita do webhook (`app/api/asaas/webhook/route.ts`, efeito
 * "pagou"). Duas cópias porque o webhook tem testes que leem o texto dele;
 * `scripts/testar-pagamentos-perdidos.mjs` prende as duas iguais.
 */
export const SQL_MARCAR_PAGO = `update tenants
          set status = 'ativo', trial_ate = null,
              ultimo_pagamento_em = now(), pago_ate = $2,
              plano_do_periodo = plano_id, atualizado_em = now()
        where id = $1`;

/** O estúdio cujas cobranças o Asaas não deixou ler — e o erro. */
export interface ConferenciaQueFalhou {
  tenantId: string;
  estudio: string;
  erro: string;
}

/**
 * Os pagamentos que o Asaas tem e nós não contamos. Não mexe em nada.
 *
 * As falhas voltam junto, e não só no log: a primeira rodada no servidor
 * (30/09/2026) não conseguiu ler NENHUMA cobrança — chave com a barra do
 * escape — e mesmo assim terminou dizendo "nenhum pagamento perdido". Quem
 * não conseguiu olhar não pode dizer que não achou.
 */
export async function procurarPagamentosPerdidos(
  agora = new Date(),
): Promise<{ perdidos: PagamentoPerdido[]; falhas: ConferenciaQueFalhou[] }> {
  if (!asaasConfigurado()) return { perdidos: [], falhas: [] };
  const estudios = await consultar<{
    id: string;
    nome_estudio: string;
    email: string;
    status: string;
    ciclo_cobranca: string;
    pago_ate: Date | null;
    asaas_assinatura_id: string;
  }>(
    `select id, nome_estudio, email, status, ciclo_cobranca, pago_ate, asaas_assinatura_id
       from tenants
      where asaas_assinatura_id is not null and status <> 'cortesia'
      order by criado_em`,
  );

  const perdidos: PagamentoPerdido[] = [];
  const falhas: ConferenciaQueFalhou[] = [];
  for (const e of estudios) {
    let cobranca;
    try {
      cobranca = await ultimaCobrancaPaga(e.asaas_assinatura_id);
    } catch (erro) {
      falhas.push({ tenantId: e.id, estudio: e.nome_estudio, erro: erro instanceof Error ? erro.message : String(erro) });
      continue;
    }
    if (!cobranca) continue;
    // RECEIVED e não CONFIRMED: para uma cobrança já contada, RECEIVED volta
    // null (não compra tempo novo), que é exatamente a pergunta "já contei?".
    const pagoAte = pagoAteDepoisDoAviso("PAYMENT_RECEIVED", cobranca, e.ciclo_cobranca, e.pago_ate, agora);
    if (!pagoAte) continue;
    perdidos.push({
      tenantId: e.id,
      estudio: e.nome_estudio,
      email: e.email,
      status: e.status,
      cobrancaId: cobranca.id,
      valorCentavos: cobranca.centavos,
      pagoAteAntes: e.pago_ate,
      pagoAteDepois: pagoAte,
    });
  }
  return { perdidos, falhas };
}

/** Conta um pagamento perdido como o webhook contaria. */
export async function registrarPagamentoPerdido(p: PagamentoPerdido): Promise<void> {
  await consultar(SQL_MARCAR_PAGO, [p.tenantId, p.pagoAteDepois]);
  console.log(`[pagamentos-perdidos] cobrança ${p.cobrancaId} contada agora → estúdio ${p.tenantId}`);
  await recalcularCombo(p.tenantId, "pagamento-perdido").catch((erro) =>
    console.error(`[pagamentos-perdidos] combo de ${p.tenantId}:`, erro),
  );
  await avisarPagamento(p.tenantId, {
    valor: p.valorCentavos / 100,
    evento: "achado na conferência (o aviso do Asaas não chegou)",
    primeiro: !p.pagoAteAntes,
  }).catch((erro) => console.error(`[pagamentos-perdidos] e-mail de ${p.tenantId}:`, erro));
}
