/**
 * Quem pode continuar ENVIANDO coisa nova.
 *
 * Regra PURA de propósito: recebe `cobrancaLigada` em vez de importar o módulo
 * do Asaas. Assim dá para testar as combinações de status sem subir servidor
 * nem configurar chave — e a dependência fica explícita em vez de escondida
 * num import.
 *
 * Duas decisões que valem explicar, porque não são óbvias:
 *
 * 1. O portão só existe quando a cobrança está ligada. Enquanto o Asaas está
 *    adormecido, ninguém tem como pagar — travar a conta seria punir a pessoa
 *    por uma porta que nós não abrimos.
 *
 * 2. Bloqueia ADICIONAR, nunca tira do ar o que já foi entregue. O casal que
 *    recebeu a galeria não deve nada a ninguém, e derrubar as fotos do casamento
 *    dele para cobrar o fotógrafo seria pegar o refém errado. A pressão certa é
 *    o fotógrafo não conseguir entregar o PRÓXIMO trabalho.
 *
 * O trial só vale enquanto não venceu; depois disso é preciso assinar.
 */

export type MotivoBloqueio = "trial_vencido" | "inadimplente" | "cancelado";

export interface Situacao {
  podeEnviar: boolean;
  motivo?: MotivoBloqueio;
  /** Texto pronto para a pessoa — sempre diz o que fazer, não só o que houve. */
  recado?: string;
}

const RECADOS: Record<MotivoBloqueio, string> = {
  trial_vencido:
    "Seu teste grátis terminou. Ative a assinatura em Conta para voltar a enviar arquivos — as galerias já publicadas continuam no ar.",
  inadimplente:
    "Há uma cobrança em aberto. Assim que o pagamento for confirmado, o envio volta automaticamente — as galerias já publicadas continuam no ar.",
  cancelado:
    "Sua assinatura foi cancelada. Ative de novo em Conta para voltar a enviar arquivos — as galerias já publicadas continuam no ar.",
};

/** Só o que a regra precisa — assim serve para Tenant e para um caso de teste. */
export interface ContaParaAvaliar {
  status: string;
  trial_ate: Date | string | null;
}

export function situacaoDoTenant(tenant: ContaParaAvaliar, cobrancaLigada: boolean): Situacao {
  // Cobrança desligada: nada a cobrar, nada a bloquear.
  if (!cobrancaLigada) return { podeEnviar: true };

  if (tenant.status === "ativo") return { podeEnviar: true };

  if (tenant.status === "trial") {
    const venceu = tenant.trial_ate ? new Date(tenant.trial_ate).getTime() < Date.now() : false;
    if (!venceu) return { podeEnviar: true };
    return { podeEnviar: false, motivo: "trial_vencido", recado: RECADOS.trial_vencido };
  }

  if (tenant.status === "inadimplente") {
    return { podeEnviar: false, motivo: "inadimplente", recado: RECADOS.inadimplente };
  }
  if (tenant.status === "cancelado") {
    return { podeEnviar: false, motivo: "cancelado", recado: RECADOS.cancelado };
  }

  // Status desconhecido: liberar. Um bug de digitação numa coluna de texto não
  // pode virar bloqueio silencioso de quem está pagando em dia.
  return { podeEnviar: true };
}
