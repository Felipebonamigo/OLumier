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

import { planoPorId, custoArmazenamentoCentavos, type Ciclo } from "./planos";

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
  const custo = custoArmazenamentoCentavos({ segmento: plano.segmento, espacoGb: plano.quotaGb });
  return Math.round(custo * FOLGA_ESPACO) + TAXA_COBRANCA;
}

/**
 * Quanto sobra de lucro depois de separar a reserva de custo.
 *
 * ── POR QUE O CICLO ENTRA NESTA CONTA ─────────────────────────────────────
 * A reserva segura, na conta, o dinheiro dos fornecedores; o split manda o
 * resto embora na hora em que o pagamento cai. No mensal isso fecha sozinho:
 * cobrou um mês, reserva um mês.
 *
 * No anual não. O estúdio paga UMA vez e ocupa o disco por DOZE meses. Se a
 * reserva do anual continuasse sendo de um mês — ou mesmo dos dez que ele
 * pagou — o split despacharia para as carteiras dos sócios um dinheiro que
 * ainda vai ser gasto em armazenamento, e a conta só apareceria torta no
 * décimo primeiro mês, com o cliente em dia e nenhum alarme tocando.
 *
 * Por isso o custo é multiplicado por 12 e a taxa de cobrança NÃO: são doze
 * meses de disco, e uma cobrança só no ano. Essa economia de onze taxas é real
 * e fica no lucro, que é o lugar certo dela.
 */
export function lucroCentavos(
  planoId: string,
  precoCentavos: number,
  ciclo: Ciclo = "mensal",
): number {
  const meses = ciclo === "anual" ? 12 : 1;

  const doPlano = reservaDoPlano(planoId);
  const reserva =
    doPlano === null
      ? /* Id irreconhecível cai num terço do preço — chute conservador, e o
         * único caminho em que a reserva não sai do espaço contratado. Aqui o
         * preço JÁ é o do ciclo, então não se multiplica de novo. */
        Math.round(precoCentavos * 0.35)
      : (doPlano - TAXA_COBRANCA) * meses + TAXA_COBRANCA;

  return Math.max(0, precoCentavos - reserva);
}

/**
 * ── SOBRE O QUE SE DIVIDE ─────────────────────────────────────────────────
 *
 * `lucro`   — a reserva de custo FICA na conta principal (é de onde saem as
 *             faturas da Backblaze e da Cloudflare) e o split manda embora só o
 *             que sobra. Era o desenho original.
 *
 * `receita` — divide tudo. Decisão do Felipe em 31/08/2026: os sócios acertam o
 *             custo entre si por fora, fora do sistema.
 *
 * A conta final das duas é a MESMA, desde que o custo seja rateado nos mesmos
 * percentuais. O que muda é quem adianta o dinheiro: em `receita` a conta
 * principal fica zerada e as faturas dos fornecedores caem inteiras no cartão
 * do Felipe, que depois cobra a parte de cada um. Nas faixas grandes isso é
 * caixa de verdade — em 10 TB, 50% da receita é menos que a reserva do plano.
 *
 * Trocar aqui muda o FORMATO do que vai ao Asaas, não só o valor: ver
 * `montarFatias` e `scripts/testar-split.mjs`, que explicam por que `receita`
 * precisa ir em percentual e não em valor fixo.
 */
export type BaseDoSplit = "lucro" | "receita";
export const BASE_DO_SPLIT: BaseDoSplit = "receita";

export interface FatiaSocio {
  socio: Socio;
  carteira: string;
  /**
   * Quanto se espera que chegue.
   *
   * Em `lucro` é o valor exato que vai no split. Em `receita` é ESTIMATIVA, e
   * não é ela que o Asaas usa: quem divide é o percentual, aplicado por eles
   * sobre o líquido real. Serve para relatório (`ensaio-cobranca`), não para
   * cobrança.
   */
  centavos: number;
  /** Só em `receita` — é isto que vai ao Asaas, como `percentualValue`. */
  percentual?: number;
}

/**
 * Monta as fatias do split para um plano.
 *
 * Sócio sem carteira configurada não entra: a parte dele fica na conta
 * principal em vez de virar erro na cobrança. É de propósito — cobrança que
 * falha por configuração incompleta é muito pior que dinheiro parado.
 */
export function montarFatias(
  planoId: string,
  precoCentavos: number,
  ciclo: Ciclo = "mensal",
): FatiaSocio[] {
  /* O ciclo TEM de atravessar até aqui. `lucroCentavos` saber do anual não
   * adianta nada se quem monta o split chamar sem contar: o cálculo fica certo
   * num lugar e errado no outro, e as duas funções parecem corretas isoladas.
   * `testar-planos.mjs` junta as duas de propósito. */
  const fatias: FatiaSocio[] = [];

  /*
   * DIVIDINDO A RECEITA, VAI EM PERCENTUAL — e isso é regra do Asaas, não gosto.
   *
   * O split é validado contra o valor LÍQUIDO, e líquido é o que sobra depois
   * da taxa. A taxa depende do meio de pagamento, que aqui é escolha do cliente
   * (`billingType: "UNDEFINED"`): Pix, boleto e cartão cobram diferente, e o
   * cartão cobra percentual. No instante em que a assinatura é criada, ninguém
   * sabe qual será.
   *
   * Mandar a receita inteira em `fixedValue` seria, então, chutar a taxa. Chute
   * baixo e a soma passa do líquido: o Asaas BLOQUEIA a cobrança, dispara
   * `PAYMENT_SPLIT_DIVERGENCE_BLOCK`, dá 2 dias úteis e depois cancela os
   * splits. Chute alto e sobra dinheiro sem dono. Em percentual o próprio Asaas
   * aplica sobre o líquido que ele calculou, e a soma nunca estoura.
   *
   * O ciclo não entra: 25% de uma cobrança anual já são 25% do ano.
   */
  if (BASE_DO_SPLIT === "receita") {
    const liquidoEstimado = Math.max(0, precoCentavos - TAXA_COBRANCA);
    for (const socio of SOCIOS) {
      const carteira = process.env[socio.variavelCarteira];
      if (!carteira) continue;
      fatias.push({
        socio,
        carteira,
        percentual: socio.percentual,
        centavos: Math.floor((liquidoEstimado * socio.percentual) / 100),
      });
    }
    return fatias;
  }

  const lucro = lucroCentavos(planoId, precoCentavos, ciclo);

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
