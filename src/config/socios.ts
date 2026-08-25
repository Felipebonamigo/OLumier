/**
 * Divisão do dinheiro que entra.
 *
 * O desenho responde ao pedido do Felipe: "o pagamento abate o custo e eu fico
 * só com o lucro". Como Cloudflare e Backblaze cobram um cartão (não recebem
 * split), o efeito é obtido ao contrário — o split MANDA EMBORA só o lucro, e o
 * que fica parado na conta é exatamente a reserva de custo, que é de onde a
 * fatura do cartão sai.
 *
 *   cliente paga  →  Asaas desconta a taxa
 *                 →  split envia a fatia de cada sócio (LUCRO)
 *                 →  o resto FICA na conta = reserva de custo
 *
 * ⚠️  OS PERCENTUAIS ABAIXO SÃO PROPOSTA, NÃO ACORDO.
 * O Felipe pediu fatia maior por ser o idealizador e quem constrói, mas a
 * conversa com a Carol e o Sirius ainda não aconteceu. Trocar aqui é uma linha;
 * nada no resto do código depende desses números.
 */

import { planoPorId, custoPecasCentavos } from "./planos";

export interface Socio {
  id: string;
  nome: string;
  /** Fatia do LUCRO (a reserva de custo sai antes). Precisa somar 100. */
  percentual: number;
  /**
   * Carteira do Asaas que recebe. Vem do ambiente porque é dado de conta, não
   * de código — e cada sócio precisa ter conta no Asaas para receber.
   * Sócio sem carteira configurada é simplesmente pulado no split, e a parte
   * dele fica na conta principal até ele se cadastrar.
   */
  variavelCarteira: string;
}

export const SOCIOS: Socio[] = [
  { id: "felipe", nome: "Felipe", percentual: 50, variavelCarteira: "ASAAS_CARTEIRA_FELIPE" },
  { id: "carol", nome: "Carol", percentual: 25, variavelCarteira: "ASAAS_CARTEIRA_CAROL" },
  { id: "sirius", nome: "Sirius", percentual: 25, variavelCarteira: "ASAAS_CARTEIRA_SIRIUS" },
];

/**
 * Reserva de custo por plano, em centavos.
 *
 * Sai da planilha de custos validada, com folga proposital: a Cloudflare cobra
 * em DÓLAR e nós recebemos em real, então uma alta do câmbio não pode comer o
 * lucro dos sócios. A folga também cobre a taxa do Asaas.
 *
 * Regra de bolso usada: custo teto do plano + ~40% de folga + R$ 3 de taxa.
 */
export const RESERVA_POR_PLANO: Record<string, number> = {
  "foto-100": 2500, // custo teto R$ 18
  "foto-200": 4500, // custo teto R$ 37
  "foto-500": 11000, // custo teto R$ 91
  "filme-1000": 15000, // custo teto R$ 135
  "filme-2000": 26000, // custo teto R$ 234
  "filme-5000": 55000, // custo teto R$ 498
};

/**
 * Folgas sobre o custo teto: cobrem alta do dólar sem comer o lucro dos sócios.
 *
 * São DUAS de propósito (25/08/2026): a galeria tem lucro gordo em cima da
 * reserva, que já absorve câmbio ruim — 30% de folga basta. O cofre vive de
 * margem ~zero por desenho, então a folga é a ÚNICA proteção cambial dele;
 * 50% segura dólar até ~R$ 8 sem a peça virar subsídio.
 */
export const FOLGA_GALERIA = 1.3;
export const FOLGA_COFRE = 1.5;
/** Taxa do Asaas por cobrança, em centavos. */
export const TAXA_COBRANCA = 300;

/**
 * Reserva de uma montagem do quebra-cabeça.
 *
 * A tabela acima não serve para as montagens novas: as peças combinam em mais
 * de cem planos possíveis, e uma tabela escrita à mão ou ficaria incompleta ou
 * envelheceria calada. Aqui a reserva sai do custo real da montagem — mesma
 * regra de bolso de antes (custo teto + folga + taxa), só que calculada, com a
 * folga de cada peça.
 *
 * O custo vem da rota EM PRODUÇÃO (hoje: tudo R2 + espelho B2). Em montagem
 * grande isso pode passar do preço — `lucroCentavos` trava o lucro em zero e o
 * split não manda nada: 100% fica na conta até a obra da rota barata sair.
 * Distribuir "lucro" calculado numa rota que não existe seria pagar sócio com
 * dinheiro da fatura da Cloudflare.
 */
function reservaDaMontagem(planoId: string): number | null {
  const plano = planoPorId(planoId);
  if (!plano || !planoId.startsWith("g:")) return null;
  const pecas = custoPecasCentavos({
    segmento: plano.segmento,
    galeriaGb: plano.quotaGb,
    cofreGb: plano.cofreGb,
  });
  return Math.round(pecas.galeria * FOLGA_GALERIA + pecas.cofre * FOLGA_COFRE) + TAXA_COBRANCA;
}

/** Quanto sobra de lucro depois de separar a reserva de custo. */
export function lucroCentavos(planoId: string, precoCentavos: number): number {
  const reserva =
    RESERVA_POR_PLANO[planoId] ?? reservaDaMontagem(planoId) ?? Math.round(precoCentavos * 0.35);
  return Math.max(0, precoCentavos - reserva);
}

export interface FatiaSocio {
  socio: Socio;
  carteira: string;
  centavos: number;
}

/**
 * Monta as fatias do split para um plano.
 *
 * Sócio sem carteira configurada não entra: a parte dele fica na conta
 * principal em vez de virar erro na cobrança. É de propósito — cobrança que
 * falha por configuração incompleta é muito pior que dinheiro parado.
 */
export function montarFatias(planoId: string, precoCentavos: number): FatiaSocio[] {
  const lucro = lucroCentavos(planoId, precoCentavos);
  const fatias: FatiaSocio[] = [];

  for (const socio of SOCIOS) {
    const carteira = process.env[socio.variavelCarteira];
    if (!carteira) continue;
    const centavos = Math.floor((lucro * socio.percentual) / 100);
    if (centavos > 0) fatias.push({ socio, carteira, centavos });
  }
  return fatias;
}

/** Confere que a configuração faz sentido — chamado nos testes e no painel. */
export function conferirConfiguracao(): { ok: boolean; avisos: string[] } {
  const avisos: string[] = [];
  const soma = SOCIOS.reduce((s, x) => s + x.percentual, 0);
  if (soma !== 100) avisos.push(`os percentuais somam ${soma}%, deveriam somar 100%`);

  const semCarteira = SOCIOS.filter((s) => !process.env[s.variavelCarteira]).map((s) => s.nome);
  if (semCarteira.length > 0) {
    avisos.push(`sem carteira do Asaas: ${semCarteira.join(", ")} (a parte fica na conta principal)`);
  }
  return { ok: avisos.length === 0, avisos };
}
