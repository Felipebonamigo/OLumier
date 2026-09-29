/**
 * Quem pode continuar ENVIANDO coisa nova.
 *
 * Regra PURA de propósito: recebe `cobrancaLigada` em vez de importar o módulo
 * do Asaas. Assim dá para testar as combinações de status sem subir servidor
 * nem configurar chave — e a dependência fica explícita em vez de escondida
 * num import.
 *
 * Três decisões que valem explicar, porque não são óbvias:
 *
 * 1. O portão só existe quando a cobrança está ligada. Enquanto o Asaas está
 *    adormecido, ninguém tem como pagar — travar a conta seria punir a pessoa
 *    por uma porta que nós não abrimos.
 *
 * 2. Bloqueia ADICIONAR, quase nunca tira do ar o que já foi entregue. O casal
 *    que recebeu a galeria não deve nada a ninguém, e derrubar as fotos do
 *    casamento dele para cobrar o fotógrafo seria pegar o refém errado. A
 *    pressão certa é o fotógrafo não conseguir entregar o PRÓXIMO trabalho.
 *
 *    A única exceção é o trial abandonado, e ela mora em `galeriasNoAr`, não
 *    aqui: quem testou 14 dias e sumiu ocuparia disco para sempre. O casal
 *    ainda ganha 15 dias de janela. Os ARQUIVOS só saem aos 60 dias, depois de
 *    dois avisos por e-mail — ver `lib/testes-abandonados.ts` (28/09/2026).
 *
 * 3. Cancelar para a RENOVAÇÃO, não o acesso. Ver `pago_ate` mais abaixo.
 *
 * O trial só vale enquanto não venceu; depois disso é preciso assinar.
 */

import { CARENCIA_POS_TRIAL_DIAS } from "@/config/trial";
import { dataDoAsaas } from "@/config/troca-de-plano";

export type MotivoBloqueio = "trial_vencido" | "inadimplente" | "cancelado";

export interface Situacao {
  podeEnviar: boolean;
  motivo?: MotivoBloqueio;
  /** Texto pronto para a pessoa — sempre diz o que fazer, não só o que houve. */
  recado?: string;
  /**
   * Recado de quem PODE enviar mas tem prazo. Campo separado de `recado` de
   * propósito: as duas telas que consultam esta regra desenham o recado dentro
   * de `if (!podeEnviar)`, então um aviso enfiado ali nunca apareceria — e o
   * estúdio cancelado descobriria o fim do período no dia em que o upload
   * parasse.
   */
  aviso?: string;
}

const RECADOS: Record<MotivoBloqueio, string> = {
  trial_vencido:
    "Seu teste grátis terminou. Ative a assinatura em Conta para voltar a enviar arquivos. " +
    "As galerias já publicadas ficam no ar por mais 15 dias — depois disso saem do ar, e os arquivos continuam guardados. " +
    "Sem assinatura, eles são apagados 60 dias depois do fim do teste, sempre com dois avisos por e-mail antes. Assinar até lá devolve tudo.",
  inadimplente:
    "Há uma cobrança em aberto. Assim que o pagamento for confirmado, o envio volta automaticamente — as galerias já publicadas continuam no ar.",
  cancelado:
    "Sua assinatura foi cancelada. Ative de novo em Conta para voltar a enviar arquivos — as galerias já publicadas continuam no ar.",
};

/** Só o que a regra precisa — assim serve para Tenant e para um caso de teste. */
export interface ContaParaAvaliar {
  status: string;
  trial_ate: Date | string | null;
  /**
   * Até quando o dinheiro que JÁ ENTROU cobre o serviço. `null` = nada pago
   * ainda (trial, ou assinatura que nunca chegou a ser cobrada).
   */
  pago_ate?: Date | string | null;
}

/** Data em dd/mm/aaaa com dois dígitos sempre — o dia 1 não pode virar "1/9". */
function porExtenso(data: Date): string {
  return data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function comoData(valor: Date | string | null | undefined): Date | null {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function situacaoDoTenant(tenant: ContaParaAvaliar, cobrancaLigada: boolean): Situacao {
  // Cobrança desligada: nada a cobrar, nada a bloquear.
  if (!cobrancaLigada) return { podeEnviar: true };

  if (tenant.status === "ativo") return { podeEnviar: true };

  /*
   * CORTESIA: acesso de pagante, receita de zero (migração 032).
   *
   * Escrito por extenso, e não deixado cair no `return` de status desconhecido
   * lá embaixo — que é onde ele caía antes de existir esta linha, e onde
   * funcionava por acidente. O dia em que alguém trocar aquele padrão
   * permissivo por um bloqueio, as contas de cortesia parariam de enviar sem
   * ninguém entender por quê.
   *
   * A metade "receita de zero" não mora aqui: `receitaMensalCentavos` soma só
   * `ativo`, então a cortesia fica de fora por construção. Ver
   * `lib/metricas-admin.ts`.
   */
  if (tenant.status === "cortesia") return { podeEnviar: true };

  if (tenant.status === "trial") {
    const venceu = tenant.trial_ate ? new Date(tenant.trial_ate).getTime() < Date.now() : false;
    if (!venceu) return { podeEnviar: true };
    return { podeEnviar: false, motivo: "trial_vencido", recado: RECADOS.trial_vencido };
  }

  if (tenant.status === "inadimplente") {
    /*
     * O período pago NÃO vale aqui, e é de propósito. Inadimplência é a régua
     * da cobrança em aberto — que é justamente a do período A SEGUIR —, e essa
     * régua ninguém desenhou ainda. Misturar as duas faria o conserto do
     * cancelamento decidir, de carona, uma política de atraso que não foi
     * discutida.
     */
    return { podeEnviar: false, motivo: "inadimplente", recado: RECADOS.inadimplente };
  }

  if (tenant.status === "cancelado") {
    /*
     * Cancelar para a RENOVAÇÃO, não o acesso.
     *
     * Até 26/08/2026 este ramo recusava na hora. No mensal ninguém notava — o
     * mês cobrado já tinha sido usado. No anual o estrago era claro: o estúdio
     * pagava doze meses de uma vez e, cancelando no segundo, perdia dez meses
     * que estavam pagos. Dinheiro recebido, serviço não entregue.
     */
    const fim = comoData(tenant.pago_ate);
    if (fim && fim.getTime() > Date.now()) {
      return {
        podeEnviar: true,
        aviso: `Assinatura cancelada. Você continua enviando arquivos até ${porExtenso(fim)}, que é o fim do período já pago. Depois disso as galerias publicadas seguem no ar, mas o envio para.`,
      };
    }
    return { podeEnviar: false, motivo: "cancelado", recado: RECADOS.cancelado };
  }

  // Status desconhecido: liberar. Um bug de digitação numa coluna de texto não
  // pode virar bloqueio silencioso de quem está pagando em dia.
  return { podeEnviar: true };
}

/**
 * A entrega ainda abre para o visitante?
 *
 * Separada de `situacaoDoTenant` de propósito: aquela responde "o FOTÓGRAFO
 * pode enviar", esta responde "o CLIENTE DELE ainda vê". São perguntas
 * diferentes e a resposta certa é diferente na maior parte dos estados — quem
 * cancelou não envia mais e continua entregando o que já publicou.
 *
 * Só o trial vencido há mais de `CARENCIA_POS_TRIAL_DIAS` fecha a porta.
 * `cancelado` e `inadimplente` ficam de fora porque os recados desses dois
 * estados prometem, por escrito, que as galerias publicadas continuam no ar.
 *
 * Nada é apagado AQUI: a galeria deixa de abrir e volta no dia em que o pagamento
 * confirmar, porque a regra é lida na hora e não gravada em lugar nenhum.
 *
 * Falha para o lado de MOSTRAR: sem data, com status desconhecido ou com
 * qualquer coisa fora do previsto, a galeria fica no ar. Derrubar a entrega do
 * casal por um estado que ninguém previu é pior do que servir um trial vencido
 * por mais um tempo.
 */
export function galeriasNoAr(
  tenant: {
    status: string;
    trial_ate: Date | string | null;
  },
  /*
   * A cobrança está ligada? OBRIGATÓRIO, sem valor padrão, de propósito: é o
   * que obriga cada chamador a responder.
   *
   * Até 29/09/2026 esta regra não perguntava. Com a cobrança desligada no
   * servidor, o teste que vencia continuava valendo como "não pagou" — e a
   * galeria saía do ar para o cliente do fotógrafo 15 dias depois, sem que
   * existisse jeito nenhum de pagar para ela voltar. A tela de Conta dizia
   * "enquanto isso, o uso segue liberado", e a entrega do casal sumia.
   *
   * É a decisão 1 do cabeçalho deste arquivo, que `situacaoDoTenant` sempre
   * seguiu e esta regra não: sem porta para pagar, ninguém é punido por não
   * passar por ela.
   */
  cobrancaLigada: boolean,
): boolean {
  if (!cobrancaLigada) return true;
  if (tenant.status !== "trial") return true;

  const fim = comoData(tenant.trial_ate);
  if (!fim) return true;

  const limite = fim.getTime() + CARENCIA_POS_TRIAL_DIAS * 24 * 60 * 60 * 1000;
  return Date.now() <= limite;
}

// --- período pago ---------------------------------------------------------

/**
 * Até quando um pagamento cobre o serviço.
 *
 * O anual compra DOZE meses, não os dez que a fatura cobra: o desconto está no
 * preço (paga 10, leva 12 — ver `MESES_PAGOS_NO_ANO` em src/config/planos.ts).
 * Se o período seguisse a fatura, todo estúdio anual ficaria dois meses sem
 * cobertura por ano, e descobriria exatamente ao cancelar.
 *
 * Ciclo que não reconhecemos cai em mensal. Errar para o lado curto custa dias
 * de acesso; errar para o longo custa um ano de disco pago do bolso.
 *
 * Sobre a aritmética de mês: 31/01 + 1 mês cai em 03/03, porque fevereiro é
 * curto. São dois dias a mais para o estúdio, uma vez por ano, e trocar isso
 * por uma conta de calendário à mão não paga o próprio custo de leitura.
 */
export function fimDoPeriodoPago(ciclo: string | null | undefined, pagoEm: Date): Date {
  const meses = ciclo === "anual" ? 12 : 1;
  const fim = new Date(pagoEm.getTime());
  fim.setMonth(fim.getMonth() + meses);
  return fim;
}

/** As datas da cobrança que o Asaas manda no corpo do webhook ("2026-09-29"). */
export interface DatasDaCobranca {
  confirmedDate?: string | null;
  clientPaymentDate?: string | null;
  paymentDate?: string | null;
}

/**
 * O `pago_ate` depois de um aviso de pagamento — ou `null` quando o aviso é
 * repetição de uma cobrança já contada e não deve mudar NADA no estúdio.
 *
 * No cartão o Asaas avisa duas vezes, com um mês entre os avisos:
 * PAYMENT_CONFIRMED na aprovação e PAYMENT_RECEIVED 32 dias depois, quando o
 * dinheiro cai (boleto: dias depois; Pix: só o RECEIVED). Até 29/09/2026 cada
 * aviso contava o período a partir do momento em que chegava, e o segundo:
 *
 *   · empurrava `pago_ate` quase um mês — a mais para quem cancelou;
 *   · marcava `ativo` de novo quem tinha cancelado, e `ativo` envia sem olhar
 *     `pago_ate`: acesso para sempre, sem assinatura nenhuma. Idem para quem
 *     estava inadimplente com a mensalidade seguinte.
 *
 * Duas regras fecham isso sem guardar id de cobrança:
 *
 * 1. O período conta do DIA DA CONFIRMAÇÃO que vem no corpo, igual nos dois
 *    avisos — não do momento do aviso. Começo do dia em Brasília, como o resto
 *    das datas do Asaas (`dataDoAsaas`). Sem data válida no corpo, vale o
 *    momento do aviso. Faltando só no primeiro, a regra 2 segue de pé (o
 *    momento dele nunca é anterior ao dia da confirmação); faltando no
 *    segundo, ele volta a contar do momento dele. O exemplo da documentação do
 *    Asaas (conferido em 29/09/2026) traz `confirmedDate` no RECEIVED do cartão.
 *
 * 2. O RECEIVED só vale se comprar tempo novo. Isso só acontece quando não houve
 *    CONFIRMED antes: Pix, recebimento em dinheiro, ou um CONFIRMED perdido.
 *    O CONFIRMED sempre vale (é o pagamento acontecendo), mas nunca encolhe o
 *    período — um anual rodando continua pago se entrar uma mensalidade.
 *
 * Limite conhecido: quem paga, cancela e reassina pagando no Pix NO MESMO DIA
 * fica `cancelado` até a mensalidade seguinte, porque o Pix novo compra o mesmo
 * fim do anterior e é lido como repetição. A saída, se um dia acontecer, é
 * guardar o `payment.id` já contado em vez de inferir pela data.
 */
export function pagoAteDepoisDoAviso(
  evento: string,
  cobranca: DatasDaCobranca | null | undefined,
  ciclo: string | null | undefined,
  pagoAteAtual: Date | string | null | undefined,
  agora: Date,
): Date | null {
  const confirmadaEm =
    dataDoAsaas(cobranca?.confirmedDate) ??
    dataDoAsaas(cobranca?.clientPaymentDate) ??
    dataDoAsaas(cobranca?.paymentDate) ??
    agora;
  const fim = fimDoPeriodoPago(ciclo, confirmadaEm);
  const atual = comoData(pagoAteAtual);

  if (!atual || fim.getTime() > atual.getTime()) return fim;
  return evento === "PAYMENT_CONFIRMED" ? atual : null;
}

/**
 * O que cada evento do Asaas faz com a conta.
 *
 * Mora aqui, e não na rota, por causa de UMA distinção que é fácil perder de
 * vista: "cancelou" e "estornou" acabavam no mesmo conjunto, e passaram a ter
 * efeitos opostos sobre o período pago.
 *
 *   cancelou → o dinheiro FICOU conosco  → o período pago continua de pé
 *   estornou → o dinheiro VOLTOU         → o período pago é zerado
 *
 * Juntos, um chargeback devolveria o dinheiro ao cliente e deixaria o acesso
 * pago no ar — com o disco correndo por nossa conta. Separados, a regra é
 * testável sem servidor e sem chave do Asaas.
 */
export type EfeitoDoEvento = "pagou" | "atrasou" | "cancelou" | "estornou";

const EFEITOS: Record<string, EfeitoDoEvento> = {
  // O Asaas manda os dois para a MESMA cobrança — no cartão, com 32 dias entre
  // eles. Quanto cada aviso compra, e quando o segundo não muda nada, é
  // `pagoAteDepoisDoAviso`: dois avisos do mesmo pagamento valem UM período.
  PAYMENT_CONFIRMED: "pagou",
  PAYMENT_RECEIVED: "pagou",

  PAYMENT_OVERDUE: "atrasou",

  PAYMENT_DELETED: "cancelou",
  SUBSCRIPTION_DELETED: "cancelou",

  PAYMENT_REFUNDED: "estornou",
  PAYMENT_CHARGEBACK_REQUESTED: "estornou",
};

export function efeitoDoEvento(evento: string): EfeitoDoEvento | null {
  return EFEITOS[evento] ?? null;
}
