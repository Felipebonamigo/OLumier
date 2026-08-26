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

import { planoPorId, custoEspacoCentavos } from "./planos";

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
 * Folga sobre o custo teto: cobre alta do dólar sem comer o lucro dos sócios.
 *
 * Uma só desde a unificação do plano (25/08/2026). Antes eram duas — 1,3 para a
 * galeria e 1,5 para o cofre, porque o cofre vivia de margem ~zero e a folga
 * era a única proteção cambial dele. Sem peça de cofre não há margem apertada a
 * proteger: toda faixa da grade tem lucro gordo em cima da reserva, e 30% cobre
 * dólar a ~R$ 7,15 sem tocar no repasse.
 *
 * A folga real é maior que estes 30%, porque a reserva usa o custo com o espaço
 * 100% cheio e a ocupação típica é de 30 a 60%.
 */
export const FOLGA_ESPACO = 1.3;
/** Taxa do Asaas por cobrança, em centavos. */
export const TAXA_COBRANCA = 300;

/**
 * Reserva de custo de um plano, em centavos.
 *
 * Sempre calculada do espaço contratado, nunca tabelada. Já existiu uma tabela
 * escrita à mão (`RESERVA_POR_PLANO`), e ela morreu na unificação de 25/08/2026
 * por um motivo que vale lembrar: quando as quotas dos ids antigos passaram a
 * somar galeria + cofre, os números da tabela viraram mentira em silêncio —
 * `foto-100` reservava R$ 25 para um plano que passou a custar R$ 72. Reserva
 * abaixo do custo é fatura de cartão sem dinheiro para cobrir, e uma tabela
 * envelhece sem avisar. O cálculo, não.
 *
 * Regra: custo teto do espaço × folga cambial + taxa da cobrança.
 *
 * O custo vem de `planos.ts` e descreve a arquitetura que está no ar: original
 * no B2, derivada no R2, sem espelho — R$ 0,0459/GB.
 *
 * Se um dia o custo voltar a passar do preço numa faixa, `lucroCentavos` trava
 * o lucro em zero e o split não manda nada: 100% fica na conta. Distribuir
 * "lucro" que a fatura vai comer seria pagar sócio com dinheiro do fornecedor.
 *
 * Essa trava já ficou ligada tempo demais uma vez. Entre 25 e 26/08/2026 o
 * custo era calculado numa rota que tinha deixado de existir (R$ 0,1207/GB), e
 * nenhuma faixa de 1 TB para cima repassou um centavo — protegendo contra um
 * prejuízo que não existia mais. Por isso `testar-planos.mjs` agora exige que
 * TODA faixa libere lucro: no dia em que uma travar, alguém é obrigado a
 * decidir, em vez de o dinheiro parar sozinho e em silêncio.
 */
function reservaDoPlano(planoId: string): number | null {
  const plano = planoPorId(planoId);
  if (!plano) return null;
  const custo = custoEspacoCentavos({ segmento: plano.segmento, espacoGb: plano.quotaGb });
  return Math.round(custo * FOLGA_ESPACO) + TAXA_COBRANCA;
}

/** Quanto sobra de lucro depois de separar a reserva de custo. */
export function lucroCentavos(planoId: string, precoCentavos: number): number {
  /* Id irreconhecível cai num terço do preço — chute conservador, e o único
   * caminho em que a reserva não sai do espaço contratado. */
  const reserva = reservaDoPlano(planoId) ?? Math.round(precoCentavos * 0.35);
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
