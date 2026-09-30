import "server-only";
import { consultar } from "@/lib/db";
import { marca } from "@/config/marca";
import { planoPorId, type Ciclo } from "@/config/planos";
import {
  descontoDaGaleriaCentavos,
  descricaoDaAssinatura,
  precoDoCicloComComboCentavos,
  type FaixaAtomatiza,
} from "@/config/combo";
import type { FormaAssinatura } from "@/config/forma-assinatura";
import { asaasConfigurado, criarAssinatura, garantirCliente, proximaCobranca } from "@/lib/asaas";
import { faixaDoAtomatiza } from "@/lib/combo";
import { conferirDocumento, soDigitos } from "@/lib/documento";
import { documentoEmUso } from "@/lib/cadastro";
import { buscarTenantPorId } from "@/lib/tenants";

/**
 * ASSINAR, SEM SESSÃO — o núcleo de `criarAssinaturaAction`.
 *
 * Saiu da ação em 30/09/2026 para o pacote (`docs/pacote.md`): a assinatura
 * agora nasce por três caminhos — o botão da Conta, o botão "Assinar o pacote"
 * e o pedido do Atomatiza pela ponte (`/api/ponte/assinar`). As regras são as
 * mesmas nos três; só quem chama muda, e cada um põe a própria guarda (a ação
 * exige a sessão do estúdio; a ponte, o segredo).
 */

export interface OpcoesDeAssinar {
  documento: string;
  ciclo: Ciclo;
  forma: FormaAssinatura;
  /** Marca `· pacote` na descrição (ver `ehDoPacote`). */
  pacote?: boolean;
  /**
   * O preço sai com o combo DESTA faixa, sem perguntar ao Asaas. Só a ponte
   * usa, no pacote: o Atomatiza pede a assinatura daqui logo depois de criar a
   * dele, e é ele quem diz a faixa. Ausente → a regra de sempre
   * (`faixaDoAtomatiza`, lida no Asaas).
   */
  faixaDoParceiro?: FaixaAtomatiza | null;
  /** O primeiro vencimento pedido por quem chama; nunca antes de hoje. */
  vencimento?: Date;
}

export type ResultadoDeAssinar =
  | { ok: true; assinaturaId: string; valorCentavos: number; faturaUrl: string | null; vencimento: Date }
  | { ok: false; erro: string; jaAssina?: boolean };

/** Primeiro vencimento de sempre: quando o teste acaba; se já acabou, em 3 dias. */
export function vencimentoDoTeste(trialAte: Date | string | null, agora = new Date()): Date {
  const fimTrial = trialAte ? new Date(trialAte) : agora;
  const minimo = new Date(agora.getTime() + 3 * 24 * 60 * 60 * 1000);
  return fimTrial > minimo ? fimTrial : minimo;
}

/**
 * O tamanho escolhido NO formulário de assinar (30/09/2026 — Juan: "quando
 * escolhem pra assinar, vai direto pro 500GB, não dá pra escolher nem maior
 * nem menor"). A conta nasce no plano inicial e o tamanho só mudava pelo
 * "Mudar de plano", acima do formulário, que ninguém achava. Agora o
 * formulário manda o plano, e ele é trocado aqui antes de assinar — pela
 * mesma `trocarPlano`, que recusa o tamanho em que o que já está guardado
 * não cabe. Sem assinatura, trocar é só gravar o plano.
 */
export async function escolherPlanoAntesDeAssinar(
  tenantId: string,
  planoIdBruto: unknown,
  ip: string | null,
): Promise<string | null> {
  if (typeof planoIdBruto !== "string" || !planoIdBruto) return null;
  const plano = planoPorId(planoIdBruto);
  if (!plano || !planoIdBruto.startsWith("g:")) return "Tamanho inválido.";
  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant || tenant.asaas_assinatura_id || tenant.plano_id === plano.id) return null;
  const { trocarPlano } = await import("@/lib/troca-de-plano");
  const r = await trocarPlano(tenantId, plano.id, { ip });
  return "erro" in r && r.erro ? r.erro : null;
}

export async function assinarTenant(tenantId: string, opcoes: OpcoesDeAssinar): Promise<ResultadoDeAssinar> {
  if (!asaasConfigurado()) return { ok: false, erro: "A cobrança ainda não foi ligada." };

  const tenant = await buscarTenantPorId(tenantId);
  if (!tenant) return { ok: false, erro: "Conta não encontrada." };
  if (tenant.asaas_assinatura_id) return { ok: false, erro: "Esta conta já tem assinatura.", jaAssina: true };

  const plano = planoPorId(tenant.plano_id);
  if (!plano) return { ok: false, erro: "Plano inválido." };

  // O Asaas recusa cliente sem CPF/CNPJ. Conferir aqui em vez de deixar a API
  // devolver erro em inglês que não diz à pessoa o que fazer.
  const doc = soDigitos(opcoes.documento || tenant.cpf_cnpj || "");
  const problema = conferirDocumento(doc);
  if (problema) return { ok: false, erro: problema };
  /* Um documento, uma conta (migração 045) — também aqui, senão a conta antiga
   * sem CPF assinaria com o documento de outra. Antes do Asaas, para não abrir
   * cliente lá com um documento que não vai ficar gravado aqui. */
  if (await documentoEmUso(doc, tenantId)) {
    return {
      ok: false,
      erro: `Esse CPF/CNPJ já está em outra conta. Fale com a gente pelo WhatsApp ${marca.whatsappVisivel} para juntar as duas.`,
    };
  }

  const cliente = await garantirCliente({
    tenantId,
    nome: tenant.nome_estudio,
    email: tenant.email,
    cpfCnpj: doc,
  });

  // Guardar só depois do Asaas aceitar: documento recusado não deve ficar
  // gravado como se fosse válido.
  await consultar("update tenants set cpf_cnpj = $1, atualizado_em = now() where id = $2", [doc, tenantId]);

  const agora = new Date();
  const vencimento = opcoes.vencimento
    ? new Date(Math.max(opcoes.vencimento.getTime(), agora.getTime()))
    : vencimentoDoTeste(tenant.trial_ate, agora);

  /*
   * O COMBO COM O ATOMATIZA (28/09/2026). Quem já assina o Atomatiza com o
   * mesmo CPF/CNPJ entra aqui com a parte do desconto da Galeria — a outra o
   * Atomatiza aplica na assinatura de lá. Sem resposta do Asaas, a assinatura
   * nasce no preço cheio e a conferência do primeiro pagamento acerta: nunca
   * travar a assinatura por causa do desconto. No pacote, a faixa vem de quem
   * pediu (`faixaDoParceiro`). Ver `lib/combo.ts` e `docs/pacote.md`.
   */
  const faixa =
    opcoes.faixaDoParceiro !== undefined
      ? opcoes.faixaDoParceiro
      : await faixaDoAtomatiza(doc, plano).catch(() => null);

  /* O preço da fatura é o do CICLO: no anual são dez mensalidades cobradas de
   * uma vez. A grade continua guardando só o mensal — o anual é derivado,
   * nunca uma segunda tabela para dessincronizar. */
  const precoDoCiclo = precoDoCicloComComboCentavos(plano, opcoes.ciclo, faixa);

  const assinatura = await criarAssinatura({
    clienteAsaasId: cliente.id,
    tenantId,
    planoId: plano.id,
    precoCentavos: precoDoCiclo,
    ciclo: opcoes.ciclo,
    descricao: descricaoDaAssinatura(marca.nome, plano, opcoes.ciclo, faixa, opcoes.pacote ?? false),
    primeiroVencimento: vencimento,
    forma: opcoes.forma,
  });

  /* O ciclo é gravado JUNTO com o id da assinatura, na mesma escrita. Se
   * ficasse para depois, uma falha no meio deixaria uma assinatura anual
   * marcada como mensal — e a próxima troca de plano recalcularia o split com
   * reserva de um mês, mandando embora o dinheiro dos outros onze. */
  await consultar(
    `update tenants
        set asaas_cliente_id = $1, asaas_assinatura_id = $2, ciclo_cobranca = $3,
            combo_atomatiza = $4, assinatura_criada_em = now(), atualizado_em = now()
      where id = $5`,
    [cliente.id, assinatura.id, opcoes.ciclo, descontoDaGaleriaCentavos(plano, faixa) > 0 ? faixa : null, tenantId],
  );

  const fatura = await proximaCobranca(assinatura.id).catch(() => null);
  return {
    ok: true,
    assinaturaId: assinatura.id,
    valorCentavos: Math.round(Number(assinatura.value ?? precoDoCiclo / 100) * 100),
    faturaUrl: fatura?.invoiceUrl ?? null,
    vencimento,
  };
}
