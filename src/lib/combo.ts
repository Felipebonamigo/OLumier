import "server-only";
import { consultar } from "@/lib/db";
import { marca } from "@/config/marca";
import { cicloDe, planoPorId, precoDoCicloCentavos, type Ciclo, type Plano } from "@/config/planos";
import {
  DESCONTOS_MEIO_A_MEIO_28_09,
  PREFIXO_ATOMATIZA,
  linhaDaGaleria,
  planoEntraNoCombo,
  descontoDaGaleriaCentavos,
  descricaoDaAssinatura,
  faixaDaDescricaoAtomatiza,
  precoDoCicloComComboCentavos,
  type FaixaAtomatiza,
} from "@/config/combo";
import {
  asaasConfigurado,
  assinaturasDoCliente,
  atualizarAssinatura,
  buscarAssinatura,
  buscarCliente,
  clientesDoDocumento,
  temCobrancaPaga,
  temCobrancaVencida,
} from "@/lib/asaas";
import { buscarTenantPorId } from "@/lib/tenants";
import { ACOES, registrarEvento } from "@/lib/eventos";

/**
 * O COMBO COM O ATOMATIZA — a parte que fala com o Asaas.
 *
 * As regras (a tabela, a leitura das descrições, o preço) moram em
 * `config/combo.ts`. Aqui fica o que depende de rede e de banco:
 *
 *   · `faixaDoAtomatiza` — o estúdio tem o Atomatiza? Pergunta ao Asaas, pelo
 *     CPF/CNPJ. A conta é a mesma dos dois produtos, então não há segredo novo
 *     nem chamada de um sistema para o outro: cada um olha a assinatura do
 *     outro onde ela realmente está.
 *   · `recalcularCombo` — põe a NOSSA assinatura no preço certo. Nunca mexe na
 *     do Atomatiza: cada plataforma cuida da sua parte.
 *   · `recalcularComboDoCliente` — o gatilho vindo de um evento do Atomatiza
 *     (assinou, pagou, cancelou), que chega no nosso webhook porque a conta é a
 *     mesma.
 *
 * Sem resposta do Asaas, nada muda: `faixaDoAtomatiza` lança, e quem chama
 * deixa o preço como está. Na próxima conferência (o próximo pagamento de
 * qualquer um dos dois) a conta fecha.
 */

const soDigitos = (s: string) => s.replace(/\D/g, "");

/** Com mais de uma faixa viva (não deveria acontecer), vale a de desconto menor. */
const ORDEM: FaixaAtomatiza[] = ["solo", "equipe", "estudio"];

/**
 * A faixa do Atomatiza que este CPF/CNPJ assina e está em dia, ou null.
 *
 * Conta só a assinatura VIVA (ACTIVE, não apagada), que JÁ FOI PAGA ao menos
 * uma vez e está SEM cobrança vencida. Sem as duas últimas, bastaria abrir uma
 * assinatura do Atomatiza e nunca pagar para ganhar o desconto daqui — e o
 * mesmo vale lá, onde o teste grátis da Galeria daria desconto de graça. O
 * combo começa quando as duas estão pagas, e dura enquanto estão em dia.
 *
 * Os clientes não são filtrados pela referência: o Atomatiza reaproveita
 * qualquer cliente da conta com o mesmo documento (`acharOuCriarCliente`, lá),
 * inclusive o nosso. Quem diz de quem é a ASSINATURA é o `externalReference`
 * dela.
 */
export async function faixaDoAtomatiza(documento: string, plano?: Plano): Promise<FaixaAtomatiza | null> {
  const doc = soDigitos(documento);
  if (!doc) return null;

  const achadas: FaixaAtomatiza[] = [];
  for (const cliente of await clientesDoDocumento(doc)) {
    for (const a of await assinaturasDoCliente(cliente.id)) {
      if (a.deleted || a.status !== "ACTIVE") continue;
      if (!a.externalReference?.startsWith(PREFIXO_ATOMATIZA)) continue;
      const faixa = faixaDaDescricaoAtomatiza(a.description);
      if (!faixa) continue;
      if (!(await temCobrancaPaga(a.id))) continue;
      if (await temCobrancaVencida(a.id)) continue;
      achadas.push(faixa);
    }
  }
  if (achadas.length === 0) return null;
  /* Com mais de uma faixa viva (não deveria acontecer), vale a que dá o MENOR
   * desconto a este plano. Na divisão proporcional, qual é depende do tamanho
   * da galeria: em 250 GB é o Equipe, e não o Solo. Sem o plano, a ordem. */
  if (plano) {
    return achadas.reduce((a, b) => (descontoDaGaleriaCentavos(plano, b) < descontoDaGaleriaCentavos(plano, a) ? b : a));
  }
  return ORDEM.find((f) => achadas.includes(f)) ?? null;
}

/**
 * Os valores que ESTE sistema pode ter gravado para o plano: cheio, com combo,
 * ou com o combo da divisão meio a meio de 28/09 — esse último para a
 * conferência trazer à divisão proporcional quem assinou naquele dia.
 */
function valoresNossos(plano: Plano, ciclo: Ciclo): Set<number> {
  const valores = new Set([precoDoCicloCentavos(plano.precoCentavos, ciclo)]);
  for (const f of ORDEM) {
    valores.add(precoDoCicloComComboCentavos(plano, ciclo, f));
    if (planoEntraNoCombo(plano)) {
      const antigo = DESCONTOS_MEIO_A_MEIO_28_09[linhaDaGaleria(plano.quotaGb)][f];
      valores.add(precoDoCicloCentavos(plano.precoCentavos - antigo, ciclo));
    }
  }
  return valores;
}

export interface ResultadoDoCombo {
  faixa: FaixaAtomatiza | null;
  antesCentavos: number;
  depoisCentavos: number;
  mudou: boolean;
}

/**
 * Confere o combo de um estúdio e, se preciso, troca o valor da assinatura.
 *
 * Três guardas, e cada uma evita um jeito de mexer no dinheiro errado:
 *
 *   · Só assinatura viva. Cancelada não cobra mais; atualizá-la é ruído.
 *   · Só valor que este sistema gravaria. Se o valor atual não é o cheio nem
 *     um dos de combo deste plano, alguém mudou à mão no painel do Asaas (uma
 *     cortesia, um acerto) — e a conferência automática não desfaz decisão de
 *     gente. Ela avisa no log e deixa como está.
 *   · Subir de preço não mexe na fatura já emitida (`atualizarPendentes`):
 *     quem cancelou o Atomatiza volta ao cheio no ciclo seguinte. Baixar mexe:
 *     o desconto vale já.
 */
export async function recalcularCombo(tenantId: string, motivo: string): Promise<ResultadoDoCombo | null> {
  if (!asaasConfigurado()) return null;
  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant?.asaas_assinatura_id || !tenant.cpf_cnpj) return null;
  const plano = planoPorId(tenant.plano_id);
  if (!plano) return null;
  const ciclo = cicloDe(tenant.ciclo_cobranca);

  const faixa = await faixaDoAtomatiza(tenant.cpf_cnpj, plano);
  const assinatura = await buscarAssinatura(tenant.asaas_assinatura_id);
  if (assinatura.deleted || assinatura.status !== "ACTIVE") return null;

  const antes = Math.round(Number(assinatura.value) * 100);
  const depois = precoDoCicloComComboCentavos(plano, ciclo, faixa);
  const faixaQueVale = descontoDaGaleriaCentavos(plano, faixa) > 0 ? faixa : null;

  if (antes !== depois) {
    if (!valoresNossos(plano, ciclo).has(antes)) {
      console.warn(
        `[combo] estúdio ${tenantId}: a assinatura cobra ${antes} centavos, valor que este sistema ` +
          `não grava para ${plano.id} (${ciclo}). Mudado à mão no Asaas? Não mexi.`,
      );
      return { faixa: faixaQueVale, antesCentavos: antes, depoisCentavos: antes, mudou: false };
    }
    await atualizarAssinatura({
      assinaturaId: tenant.asaas_assinatura_id,
      planoId: plano.id,
      precoCentavos: depois,
      ciclo,
      descricao: descricaoDaAssinatura(marca.nome, plano, ciclo, faixa),
      atualizarPendentes: depois < antes,
    });
    await registrarEvento({
      tenantId,
      estudio: tenant.nome_estudio,
      ator: "sistema",
      acao: ACOES.COMBO_RECALCULADO,
      alvoTipo: "conta",
      alvoId: tenantId,
      detalhe: { deCentavos: antes, paraCentavos: depois, faixaAtomatiza: faixaQueVale, plano: plano.id, ciclo, motivo },
    });
  }

  if ((tenant.combo_atomatiza ?? null) !== faixaQueVale) {
    await consultar("update tenants set combo_atomatiza = $1, atualizado_em = now() where id = $2", [
      faixaQueVale,
      tenantId,
    ]);
  }

  return { faixa: faixaQueVale, antesCentavos: antes, depoisCentavos: depois, mudou: antes !== depois };
}

/**
 * Um evento da assinatura do Atomatiza chegou no nosso webhook: confere o
 * combo de quem tem o mesmo CPF/CNPJ aqui.
 *
 * O estúdio é achado pelo documento gravado na assinatura (`cpf_cnpj`), e não
 * pela referência do cliente — o cliente do evento pode ser o de lá.
 */
export async function recalcularComboDoCliente(clienteAsaasId: string, motivo: string): Promise<number> {
  if (!asaasConfigurado()) return 0;
  const cliente = await buscarCliente(clienteAsaasId);
  const doc = soDigitos(cliente.cpfCnpj ?? "");
  if (!doc) return 0;
  const estudios = await consultar<{ id: string }>(
    "select id from tenants where cpf_cnpj = $1 and asaas_assinatura_id is not null",
    [doc],
  );
  for (const e of estudios) {
    try {
      await recalcularCombo(e.id, motivo);
    } catch (erro) {
      console.error(`[combo] não consegui conferir o estúdio ${e.id} (${motivo}):`, erro);
    }
  }
  return estudios.length;
}
