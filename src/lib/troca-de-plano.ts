import "server-only";
import { consultar } from "@/lib/db";
import { marca } from "@/config/marca";
import { cicloDe, formatarReais, GB, planoPorId, type Ciclo, type Plano } from "@/config/planos";
import { montarFatiasDaDiferenca } from "@/config/socios";
import {
  descontoDaGaleriaCentavos,
  descricaoDaAssinatura,
  ehDoPacote,
  precoDoCicloComComboCentavos,
  type FaixaAtomatiza,
} from "@/config/combo";
import {
  cotarDiferenca,
  dataDoAsaas,
  diaDeBrasilia,
  fimDoPeriodoParaDiferenca,
  type CotacaoDaTroca,
} from "@/config/troca-de-plano";
import {
  asaasConfigurado,
  atualizarAssinatura,
  buscarAssinatura,
  cobrancasEmAberto,
  criarCobrancaAvulsa,
  referenciaDaDiferenca,
  type AssinaturaAsaas,
  type CobrancaAsaas,
} from "@/lib/asaas";
import { faixaDoAtomatiza } from "@/lib/combo";
import { rotuloDoCartao } from "@/lib/cartao-salvo";
import { buscarTenantPorId, type Tenant } from "@/lib/tenants";
import { usoDoEstudio } from "@/lib/medias";
import { ACOES, registrarEvento } from "@/lib/eventos";

/**
 * TROCAR DE PLANO — o fluxo, com o Asaas e o banco.
 *
 * A regra de quanto cobrar mora em `config/troca-de-plano.ts`. Aqui:
 *
 *   1. a cotação — o plano já pago no período, o preço novo (com o combo, se
 *      houver) e até quando o dinheiro já pago cobre;
 *   2. a assinatura passa ao preço novo, e a fatura que ainda não foi paga
 *      acompanha;
 *   3. a diferença, se houver, vira UMA cobrança avulsa: no cartão que a
 *      assinatura já guardou, ou numa fatura com Pix, boleto e cartão;
 *   4. o banco — o plano, o espaço e a base do período.
 *
 * A ordem existe para nunca sobrar meio caminho. Se o Asaas recusar o passo 2,
 * nada mudou. Se a diferença não puder ser cobrada de jeito nenhum, a
 * assinatura volta ao valor de antes e nada mudou também — nunca um plano
 * maior com a diferença esquecida, nem uma diferença cobrada num plano que
 * não mudou.
 */

export interface CotacaoDoPlano {
  cotacao: CotacaoDaTroca;
  plano: Plano;
  planoBase: Plano;
  ciclo: Ciclo;
  faixa: FaixaAtomatiza | null;
  precoNovoCentavos: number;
  precoBaseCentavos: number;
  /** "Visa •••• 4444" quando a diferença pode sair no cartão salvo. */
  cartao: string | null;
  assinatura: AssinaturaAsaas | null;
}

/** Quanto a troca custa agora, sem mexer em nada. */
export async function cotarTroca(tenant: Tenant, plano: Plano, agora: Date = new Date()): Promise<CotacaoDoPlano> {
  const ciclo = cicloDe(tenant.ciclo_cobranca);
  const temAssinatura = asaasConfigurado() && Boolean(tenant.asaas_assinatura_id);

  /* O combo entra nos dois preços do mesmo jeito: a diferença é a dos planos,
   * não a do desconto. Sem resposta do Asaas, sem combo — o lado seguro. */
  const faixa =
    temAssinatura && tenant.cpf_cnpj ? await faixaDoAtomatiza(tenant.cpf_cnpj, plano).catch(() => null) : null;
  const precoNovoCentavos = precoDoCicloComComboCentavos(plano, ciclo, faixa);

  const planoBase =
    planoPorId(tenant.plano_do_periodo ?? "") ?? planoPorId(tenant.plano_id) ?? plano;
  const precoBaseCentavos = precoDoCicloComComboCentavos(planoBase, ciclo, faixa);

  let assinatura: AssinaturaAsaas | null = null;
  let fim: Date | null = null;
  if (temAssinatura) {
    assinatura = await buscarAssinatura(tenant.asaas_assinatura_id!);
    const abertas = await cobrancasEmAberto(tenant.asaas_assinatura_id!);
    const vencimentos = [...abertas.map((c) => dataDoAsaas(c.dueDate)), dataDoAsaas(assinatura.nextDueDate)]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    fim = fimDoPeriodoParaDiferenca(
      tenant.pago_ate ? new Date(tenant.pago_ate) : null,
      vencimentos[0] ?? null,
      agora,
    );
  }

  const cotacao = cotarDiferenca({ precoBaseCentavos, precoNovoCentavos, ciclo, agora, fimDoPeriodo: fim });
  const cartao = assinatura?.creditCard?.creditCardToken ? rotuloDoCartao(assinatura) : null;
  return { cotacao, plano, planoBase, ciclo, faixa, precoNovoCentavos, precoBaseCentavos, cartao, assinatura };
}

export type ResultadoDaTroca =
  | { erro: string }
  | {
      ok: string;
      /** A cobrança da diferença, quando houve. */
      diferenca: { centavos: number; noCartao: boolean; url: string | null } | null;
    };

/** Recusas que não dependem de dinheiro: plano que não existe, o mesmo plano, espaço que não cabe. */
async function conferirTroca(tenant: Tenant, plano: Plano): Promise<string | null> {
  if (tenant.plano_id === plano.id) return "Você já está neste plano.";
  /*
   * Uma quota só: o que está no ar e o que está arquivado somam. Antes eram
   * duas checagens, e a do cofre recusava a descida com "apague algo do cofre"
   * — pedir para o fotógrafo apagar entrega é exatamente o que este produto
   * promete que nunca é preciso fazer.
   */
  const novaQuota = BigInt(plano.quotaGb) * BigInt(GB);
  const uso = await usoDoEstudio(tenant.id);
  const usoTotal = uso.noAr + uso.noCofre;
  if (usoTotal > novaQuota) {
    const excesso = Number(usoTotal - novaQuota) / 1024 ** 3;
    return `Seu estúdio ocupa ${excesso.toFixed(1)} GB a mais do que o ${plano.nome} permite. Apague algo antes de descer de plano.`;
  }
  return null;
}

const dataCurta = (d: Date) =>
  d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Troca o plano do estúdio.
 *
 * `cotadoCentavos` é a diferença que a tela mostrou antes do clique. Se ela
 * mudou (outra aba trocou antes, a fatura foi paga no meio), a troca é
 * recusada com o valor novo — ninguém confirma um preço e paga outro.
 */
export async function trocarPlano(
  tenantId: string,
  novoPlanoId: string,
  opcoes: { ip: string | null; cotadoCentavos?: number | null; agora?: Date },
): Promise<ResultadoDaTroca> {
  const plano = planoPorId(novoPlanoId);
  if (!plano) return { erro: "Plano inválido." };
  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return { erro: "Conta não encontrada." };
  const recusa = await conferirTroca(tenant, plano);
  if (recusa) return { erro: recusa };

  const agora = opcoes.agora ?? new Date();
  let cot: CotacaoDoPlano;
  try {
    cot = await cotarTroca(tenant, plano, agora);
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "não consegui consultar a assinatura" };
  }
  const { cotacao, ciclo, faixa, assinatura } = cot;

  if (
    opcoes.cotadoCentavos !== undefined &&
    opcoes.cotadoCentavos !== null &&
    Math.abs(cotacao.diferencaCentavos - opcoes.cotadoCentavos) > 100
  ) {
    return {
      erro: `O valor da diferença mudou desde que você abriu esta tela: agora é ${formatarReais(cotacao.diferencaCentavos)}. Confira e confirme de novo.`,
    };
  }

  let diferenca: { centavos: number; noCartao: boolean; url: string | null; id: string } | null = null;

  if (assinatura && tenant.asaas_assinatura_id) {
    /* Trocar de PLANO mantém o ciclo — quem paga por ano continua pagando por
     * ano, com o valor da faixa nova. Trocar de CICLO é outra operação, e o
     * Asaas não muda ciclo de assinatura no lugar. */
    try {
      await atualizarAssinatura({
        assinaturaId: tenant.asaas_assinatura_id,
        planoId: plano.id,
        precoCentavos: cot.precoNovoCentavos,
        ciclo,
        descricao: descricaoDaAssinatura(marca.nome, plano, ciclo, faixa, ehDoPacote(assinatura.description)),
      });
    } catch (e) {
      return { erro: e instanceof Error ? e.message : "não consegui atualizar a assinatura" };
    }

    if (cotacao.cobrar && cotacao.ate) {
      const base = {
        clienteAsaasId: tenant.asaas_cliente_id ?? assinatura.customer ?? "",
        centavos: cotacao.diferencaCentavos,
        descricao: `${marca.nome} — diferença para ${plano.nome} até ${dataCurta(cotacao.ate)}`,
        referencia: referenciaDaDiferenca(tenant.id, agora),
        fatias: montarFatiasDaDiferenca(cot.planoBase.id, plano.id, cotacao.diferencaCentavos, cotacao.mesesRestantes),
      };
      const token = assinatura.creditCard?.creditCardToken;
      let cobranca: CobrancaAsaas | null = null;
      let noCartao = false;

      /* No cartão que a assinatura já guardou: é o que a pessoa escolheu para
       * não pagar nada à mão. Recusado (limite, validade), cai para a fatura. */
      if (token && opcoes.ip) {
        try {
          cobranca = await criarCobrancaAvulsa({
            ...base,
            vencimento: diaDeBrasilia(agora),
            cartao: { token, ip: opcoes.ip },
          });
          noCartao = true;
        } catch (e) {
          console.warn(`[troca] cartão recusou a diferença do estúdio ${tenant.id}:`, e instanceof Error ? e.message : e);
        }
      }
      if (!cobranca) {
        try {
          cobranca = await criarCobrancaAvulsa({ ...base, vencimento: diaDeBrasilia(agora, 3) });
        } catch (e) {
          /* Sem como cobrar a diferença: a assinatura volta ao que era, e nada
           * mudou. Um plano maior com a diferença esquecida é o que este
           * arquivo existe para não deixar acontecer. */
          await atualizarAssinatura({
            assinaturaId: tenant.asaas_assinatura_id,
            planoId: tenant.plano_id,
            precoCentavos: Math.round(Number(assinatura.value) * 100),
            ciclo,
            descricao:
              assinatura.description ??
              descricaoDaAssinatura(marca.nome, planoPorId(tenant.plano_id) ?? plano, ciclo, faixa, ehDoPacote(assinatura.description)),
          }).catch((erroDaVolta) =>
            console.error(`[troca] estúdio ${tenant.id}: a diferença falhou E a assinatura não voltou ao valor antigo:`, erroDaVolta),
          );
          return {
            erro: `Não consegui cobrar a diferença agora (${e instanceof Error ? e.message : "Asaas fora do ar"}). Nada mudou — tente de novo em instantes.`,
          };
        }
      }
      diferenca = { centavos: cotacao.diferencaCentavos, noCartao, url: cobranca.invoiceUrl ?? null, id: cobranca.id };
    }
  }

  /* A base do período sobe junto com o plano, e fica onde estava na descida:
   * quem desce e sobe de novo no mesmo período não paga outra vez. */
  const subiu = cot.precoNovoCentavos > cot.precoBaseCentavos;
  await consultar(
    `update tenants
        set plano_id = $1, quota_bytes = $2, combo_atomatiza = $3,
            plano_do_periodo = $4, atualizado_em = now()
      where id = $5`,
    [
      plano.id,
      (BigInt(plano.quotaGb) * BigInt(GB)).toString(),
      descontoDaGaleriaCentavos(plano, faixa) > 0 ? faixa : null,
      subiu ? plano.id : (tenant.plano_do_periodo ?? tenant.plano_id),
      tenant.id,
    ],
  );

  /*
   * Guarda o plano ANTIGO e o novo, e a diferença cobrada. É a pergunta de uma
   * cobrança contestada ("por que fui cobrado a mais em março?") e ela não tem
   * resposta olhando o banco depois: lá só existe o plano atual.
   */
  await registrarEvento({
    tenantId: tenant.id,
    estudio: tenant.nome_estudio,
    ator: "estudio",
    acao: ACOES.PLANO_TROCADO,
    alvoTipo: "conta",
    alvoId: tenant.id,
    detalhe: {
      de: tenant.plano_id,
      para: plano.id,
      nome: plano.nome,
      precoCentavos: plano.precoCentavos,
      precoDoCicloCentavos: cot.precoNovoCentavos,
      diferencaCentavos: diferenca?.centavos ?? 0,
      diferencaAbsorvidaCentavos: cotacao.cobrar ? 0 : cotacao.diferencaCentavos,
      diferencaAte: cotacao.ate?.toISOString() ?? null,
      cobrancaDaDiferenca: diferenca?.id ?? null,
      noCartao: diferenca?.noCartao ?? false,
    },
    ip: opcoes.ip,
  });

  let ok = `Agora você está no ${plano.nome}.`;
  if (diferenca) {
    ok += diferenca.noCartao
      ? ` A diferença até ${dataCurta(cotacao.ate!)}, ${formatarReais(diferenca.centavos)}, foi cobrada no ${cot.cartao ?? "cartão"}.`
      : ` A diferença até ${dataCurta(cotacao.ate!)} é de ${formatarReais(diferenca.centavos)}, numa fatura com Pix, boleto ou cartão.`;
  }
  return { ok, diferenca: diferenca ? { centavos: diferenca.centavos, noCartao: diferenca.noCartao, url: diferenca.url } : null };
}

/**
 * Um aviso do Asaas sobre a cobrança da diferença chegou no webhook.
 *
 * O que ela NÃO faz é o que importa: não renova o período pago. A mensalidade
 * renova (`fimDoPeriodoPago`); a diferença só completa o período que já
 * existe — se renovasse, pagar R$ 20 de diferença daria um mês inteiro (ou um
 * ano, no anual) a partir daquele dia.
 *
 *   · vencida sem pagar → a conta fica em atraso, como numa mensalidade: o
 *     plano maior está em uso e a diferença dele não entrou;
 *   · paga → volta a "ativa" quem estava em atraso e ainda tem período pago;
 *   · cancelada ou estornada → só o registro. O preço novo já vale na próxima
 *     mensalidade, e a perda é limitada ao que faltava do período.
 */
export async function aplicarEventoDaDiferenca(
  tenantId: string,
  efeito: "pagou" | "atrasou" | "cancelou" | "estornou" | null,
  detalhe: { evento: string; cobranca: string | null; valor: number | null },
): Promise<void> {
  if (efeito === "atrasou") {
    await consultar(
      `update tenants set status = 'inadimplente', atualizado_em = now()
        where id = $1 and status = 'ativo'`,
      [tenantId],
    );
  } else if (efeito === "pagou") {
    await consultar(
      `update tenants set status = 'ativo', atualizado_em = now()
        where id = $1 and status = 'inadimplente' and pago_ate > now()`,
      [tenantId],
    );
  }
  const t = await buscarTenantPorId(tenantId);
  await registrarEvento({
    tenantId,
    estudio: t?.nome_estudio ?? "",
    ator: "sistema",
    acao: ACOES.DIFERENCA_DA_TROCA,
    alvoTipo: "conta",
    alvoId: tenantId,
    detalhe: { ...detalhe, efeito },
  });
}
