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
  ehDoPacote,
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
  return (await diagnosticarAtomatiza(documento, plano)).faixa;
}

/** O que a conferência viu numa assinatura do Atomatiza, e se ela conta. */
export interface AssinaturaVistaDoAtomatiza {
  id: string;
  descricao: string | null;
  faixa: FaixaAtomatiza | null;
  /** Vazio quando conta para o combo; senão, por que não conta. */
  foraPorque: string | null;
}

export interface DiagnosticoDoAtomatiza {
  faixa: FaixaAtomatiza | null;
  assinaturas: AssinaturaVistaDoAtomatiza[];
  /** Por que não há combo, numa frase — ou null quando há. */
  motivo: string | null;
}

/**
 * A MESMA conferência de `faixaDoAtomatiza`, contando o que viu no caminho.
 *
 * Existe para o aviso de pagamento e para `scripts/conferir-combo.mjs`
 * responderem "por que ESTE estúdio não ganhou o desconto?" sem uma segunda
 * cópia das regras — duas cópias envelheceriam separadas, e o diagnóstico
 * passaria a dizer uma coisa enquanto o preço faz outra.
 */
export async function diagnosticarAtomatiza(documento: string, plano?: Plano): Promise<DiagnosticoDoAtomatiza> {
  const doc = soDigitos(documento);
  if (!doc) return { faixa: null, assinaturas: [], motivo: "o estúdio não tem CPF/CNPJ na conta daqui" };

  const vistas: AssinaturaVistaDoAtomatiza[] = [];
  const achadas: FaixaAtomatiza[] = [];
  for (const cliente of await clientesDoDocumento(doc)) {
    for (const a of await assinaturasDoCliente(cliente.id)) {
      if (!a.externalReference?.startsWith(PREFIXO_ATOMATIZA)) continue;
      const faixa = faixaDaDescricaoAtomatiza(a.description);
      const vista: AssinaturaVistaDoAtomatiza = { id: a.id, descricao: a.description ?? null, faixa, foraPorque: null };
      vistas.push(vista);
      if (a.deleted || a.status !== "ACTIVE") {
        vista.foraPorque = a.deleted ? "apagada" : `não está ativa (${a.status})`;
        continue;
      }
      if (!faixa) {
        vista.foraPorque = "a descrição não diz a faixa (solo, equipe ou estúdio)";
        continue;
      }
      /* Vencida primeiro: vale também para o pacote, que conta antes do
       * primeiro pagamento só enquanto não vence (`docs/pacote.md`). */
      if (await temCobrancaVencida(a.id)) {
        vista.foraPorque = "tem cobrança vencida";
        continue;
      }
      if (!ehDoPacote(a.description) && !(await temCobrancaPaga(a.id))) {
        vista.foraPorque = "nenhuma cobrança paga ainda (teste ou primeira fatura em aberto)";
        continue;
      }
      achadas.push(faixa);
    }
  }

  if (achadas.length === 0) {
    const motivo =
      vistas.length === 0
        ? "nenhuma assinatura do Atomatiza com este CPF/CNPJ no Asaas"
        : `a assinatura do Atomatiza ${vistas.map((v) => v.foraPorque).join("; ")}`;
    return { faixa: null, assinaturas: vistas, motivo };
  }
  /* Com mais de uma faixa viva (não deveria acontecer), vale a que dá o MENOR
   * desconto a este plano. Na divisão proporcional, qual é depende do tamanho
   * da galeria: em 250 GB é o Equipe, e não o Solo. Sem o plano, a ordem. */
  const faixa = plano
    ? achadas.reduce((a, b) => (descontoDaGaleriaCentavos(plano, b) < descontoDaGaleriaCentavos(plano, a) ? b : a))
    : (ORDEM.find((f) => achadas.includes(f)) ?? null);
  return { faixa, assinaturas: vistas, motivo: null };
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
      descricao: descricaoDaAssinatura(marca.nome, plano, ciclo, faixa, ehDoPacote(assinatura.description)),
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

/** Tudo o que responde "este estúdio está com o desconto do combo?". */
export interface DiagnosticoDoCombo {
  tenantId: string;
  estudio: string;
  email: string;
  documento: string | null;
  planoId: string;
  ciclo: Ciclo;
  /** A faixa do Atomatiza que dá desconto a ESTE plano, ou null. */
  faixa: FaixaAtomatiza | null;
  /** Por que não há desconto, numa frase — ou null quando há. */
  motivo: string | null;
  /** Quanto a Galeria cede por mês por causa do combo, em centavos. */
  descontoMensalCentavos: number;
  /** O que a assinatura cobra hoje no Asaas, ou null sem assinatura. */
  valorAtualCentavos: number | null;
  /** O que ela deveria cobrar, com ou sem combo. */
  valorCertoCentavos: number;
  assinaturasDoAtomatiza: AssinaturaVistaDoAtomatiza[];
}

/**
 * O combo deste estúdio, conferido de ponta a ponta e sem mexer em nada: o
 * plano, o documento, o Atomatiza visto pelo Asaas e o valor que a nossa
 * assinatura cobra. Quem acerta é `recalcularCombo`; isto só explica.
 */
export async function diagnosticarCombo(tenantId: string): Promise<DiagnosticoDoCombo | null> {
  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return null;
  const plano = planoPorId(tenant.plano_id);
  const ciclo = cicloDe(tenant.ciclo_cobranca);
  const base = {
    tenantId,
    estudio: tenant.nome_estudio,
    email: tenant.email,
    documento: tenant.cpf_cnpj,
    planoId: tenant.plano_id,
    ciclo,
  };
  if (!plano) {
    return { ...base, faixa: null, motivo: `plano desconhecido (${tenant.plano_id})`, descontoMensalCentavos: 0,
      valorAtualCentavos: null, valorCertoCentavos: 0, assinaturasDoAtomatiza: [] };
  }

  let valorAtualCentavos: number | null = null;
  if (tenant.asaas_assinatura_id && asaasConfigurado()) {
    const a = await buscarAssinatura(tenant.asaas_assinatura_id);
    if (!a.deleted) valorAtualCentavos = Math.round(Number(a.value) * 100);
  }

  const atomatiza = await diagnosticarAtomatiza(tenant.cpf_cnpj ?? "", plano);
  const desconto = descontoDaGaleriaCentavos(plano, atomatiza.faixa);
  let motivo = atomatiza.motivo;
  if (!motivo && !planoEntraNoCombo(plano)) motivo = `o plano ${plano.id} é da grade antiga e fica fora do combo`;
  if (!motivo && desconto <= 0) motivo = "a tabela do combo não dá desconto a este par";

  return {
    ...base,
    faixa: desconto > 0 ? atomatiza.faixa : null,
    motivo,
    descontoMensalCentavos: desconto,
    valorAtualCentavos,
    valorCertoCentavos: precoDoCicloComComboCentavos(plano, ciclo, atomatiza.faixa),
    assinaturasDoAtomatiza: atomatiza.assinaturas,
  };
}
