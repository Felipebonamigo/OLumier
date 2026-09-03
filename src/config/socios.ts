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
 * ✅ ACORDO FECHADO em 01/09/2026, nas palavras do Felipe: "o custo todo
 * (Backblaze + Cloudflare + VPS + DAS) é dividido em 3 igualmente, e o lucro é
 * dividido 50 eu / 25 Carol / 25 Sirius". O Felipe leva mais por ser o
 * idealizador e quem constrói; o custo todos carregam igual.
 *
 * Duas peças traduzem esse acordo, e as duas estão logo abaixo: `SOCIOS` (quem
 * leva quanto) e `RATEIO_DO_CUSTO` (quem paga o custo, e em que proporção).
 * Trocar qualquer uma é uma linha; nada no resto do código depende delas.
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
/**
 * ── A TAXA DO ASAAS DEPENDE DO PREÇO, E NÃO É R$ 3,00 ─────────────────────
 *
 * Era `TAXA_COBRANCA = 300` — um número fixo, chutado. As taxas REAIS desta
 * conta, lidas em `GET /myAccount/fees` em 05/09/2026:
 *
 *     boleto  R$ 1,99        pix  R$ 1,99        cartão  R$ 0,49 + 2,99%
 *
 * O cliente escolhe como paga, então a reserva tem de aguentar a MAIS CARA — e
 * a mais cara é a única que cresce com o preço. Com R$ 3,00 fixo a conta fechava
 * no Pix e furava no cartão, que é justamente a forma que virou padrão da tela
 * em 05/09: na faixa de 10 TB anual faltavam R$ 211,47 para pagar a Backblaze,
 * saídos do bolso de quem opera.
 *
 * Reservar pelo cartão sobra-reserva para quem paga por Pix, e sobrar é o lado
 * certo do erro: o excedente é lucro a distribuir depois, pela mesma regra que
 * já vale para a folga cambial. Faltar não tem conserto — vira fatura sem
 * dinheiro para cobrir.
 *
 * `Math.ceil` pelo mesmo motivo: o centavo do arredondamento fica com a reserva.
 */
const TAXA_CARTAO_FIXA = 49;
const TAXA_CARTAO_PERCENTUAL = 0.0299;

/** A taxa que a cobrança vai custar, no pior meio de pagamento. Em centavos. */
export function taxaCobrancaCentavos(precoCentavos: number): number {
  return Math.ceil(TAXA_CARTAO_FIXA + precoCentavos * TAXA_CARTAO_PERCENTUAL);
}

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
  /* SÓ o armazenamento de UM mês, com a folga cambial. A taxa da cobrança saiu
     daqui em 05/09/2026: ela depende do PREÇO, e este função não conhece o preço
     do ciclo — quem soma a taxa é `lucroCentavos`, que conhece. */
  return Math.round(custo * FOLGA_ESPACO);
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

  const armazemDoMes = reservaDoPlano(planoId);
  const reserva =
    armazemDoMes === null
      ? /* Id irreconhecível cai num terço do preço — chute conservador, e o
         * único caminho em que a reserva não sai do espaço contratado. Aqui o
         * preço JÁ é o do ciclo, então não se multiplica de novo. */
        Math.round(precoCentavos * 0.35)
      : /* Doze meses de disco, UMA taxa de cobrança — e a taxa calculada sobre o
           preço do CICLO, que é o que o Asaas vai cobrar de verdade. Somar a taxa
           doze vezes reservaria dinheiro que ninguém vai gastar; somar a do
           mensal reservaria de menos, que é o erro caro. */
        armazemDoMes * meses + taxaCobrancaCentavos(precoCentavos);

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
export const BASE_DO_SPLIT: BaseDoSplit = "lucro";

/**
 * ── QUEM PAGA O CUSTO ─────────────────────────────────────────────────────
 *
 * `proporcional` — o custo sai do bolo antes, e o que sobra é dividido
 *                  50/25/25. Cada um banca o custo na proporção da fatia dele.
 *
 * `igual`        — o custo é dividido em TRÊS PARTES IGUAIS, e cada um recebe a
 *                  fatia dele da receita menos o seu terço. Acordo fechado com a
 *                  Carol e o Sirius em 01/09/2026: "o custo todo dividido em 3
 *                  igualmente, e o lucro 50/25/25".
 *
 * A soma distribuída é a MESMA nos dois — o lucro, nem um centavo a mais. O que
 * muda é de quem sai. Com R$ 1.000 de receita e R$ 529 de custo:
 *
 *     proporcional   Felipe 235,50   Carol 117,75   Sirius 117,75
 *     igual          Felipe 323,67   Carol  73,67   Sirius  73,67
 *
 * ⚠️ EM `igual`, O LUCRO DEIXA DE SAIR 50/25/25. No exemplo acima o Felipe fica
 * com 68,7% do lucro, não com 50% — porque ele banca só um terço de um custo que
 * a fatia dele geraria em metade. É consequência aritmética do acordo, não
 * defeito: quem quiser 50/25/25 do lucro precisa do rateio `proporcional`.
 *
 * ⚠️ O CUSTO FIXO NÃO ESTÁ AQUI. A reserva conhece armazenamento (Backblaze e
 * Cloudflare) e a taxa do Asaas. DAS-MEI, VPS e domínio (R$ 129,33/mês) não
 * pertencem a cobrança nenhuma e não têm como ser rateados por cobrança — o
 * Asaas divide uma de cada vez e não sabe o total do mês. Esse terço é acerto
 * mensal por fora, R$ 43,11 para cada um. Ver `config/custos-fixos.ts`.
 */
export type RateioDoCusto = "proporcional" | "igual";
export const RATEIO_DO_CUSTO: RateioDoCusto = "igual";

/**
 * O CAIXA DA OPERAÇÃO — a quarta carteira, opcional.
 *
 * A reserva de custo precisa ficar parada em algum lugar até a fatura da
 * Backblaze e da Cloudflare chegar. Sem esta variável ela fica na conta
 * principal, que é onde já ficava — e o problema disso não é técnico, é de
 * sociedade: dinheiro parado na conta de um sócio PARECE margem dele, e a
 * desconfiança sobre isso é o tipo de coisa que só aparece depois de brigar.
 *
 * Com a variável preenchida, a reserva vira uma LINHA COM NOME no split: sai da
 * cobrança na frente de todo mundo, todo mês, para uma conta que não é de
 * ninguém em particular. A conta é a mesma; o que muda é que ela deixa de
 * depender da palavra de quem opera.
 *
 * Vazia é o padrão de propósito: abrir conta no Asaas é decisão do Felipe e dos
 * sócios, não do código, e o sistema tem de funcionar antes dessa conversa.
 */
export const VARIAVEL_CARTEIRA_OPERACAO = "ASAAS_CARTEIRA_OPERACAO";

/**
 * O caixa não é sócio, mas ocupa uma fatia do split — então precisa da mesma
 * forma. `percentual: 0` porque a fatia dele não é fixa: é o que sobra depois
 * da reserva de cada plano, e quem calcula é `montarFatias`. Fora de `SOCIOS`
 * de propósito: ele não vota, não recebe lucro, e não pode entrar na soma que
 * tem de dar 100.
 */
export const OPERACAO: Socio = {
  id: "operacao",
  nome: "Caixa da operação",
  percentual: 0,
  variavelCarteira: VARIAVEL_CARTEIRA_OPERACAO,
};


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
  const liquido = Math.max(0, precoCentavos - taxaCobrancaCentavos(precoCentavos));
  if (liquido === 0) return fatias;

  /*
   * TUDO EM PERCENTUAL — e isso é regra do Asaas, não gosto.
   *
   * O split é validado contra o valor LÍQUIDO, e líquido é o que sobra depois
   * da taxa. A taxa depende do meio de pagamento, que aqui é escolha do cliente
   * (`billingType: "UNDEFINED"`): Pix, boleto e cartão cobram diferente, e o
   * cartão cobra percentual. No instante em que a assinatura é criada, ninguém
   * sabe qual será.
   *
   * Mandar valor fixo seria, então, chutar a taxa. Chute baixo e a soma passa do
   * líquido: o Asaas BLOQUEIA a cobrança, dispara
   * `PAYMENT_SPLIT_DIVERGENCE_BLOCK`, dá 2 dias úteis e depois cancela os
   * splits. Em percentual quem aplica é o próprio Asaas, sobre o líquido que ele
   * calculou, e a soma nunca estoura.
   *
   * O ciclo não entra no percentual: 25% de uma cobrança anual já são 25% do
   * ano. Ele entra na RAZÃO, porque o lucro do anual é outro.
   */
  const lucro = lucroCentavos(planoId, precoCentavos, ciclo);

  /*
   * A RAZÃO — o que sobra para dividir, depois de guardada a reserva.
   *
   * Em `lucro` ela é `lucro / líquido`, e varia MUITO com o plano: 87% em
   * 100 GB, 25% em 10 TB. Não é distorção, é o custo real de cada faixa — o
   * cliente de 10 TB consome quinze vezes mais armazenamento que o de 100 GB
   * pelo mesmo tipo de mensalidade.
   *
   * Foi essa variação que matou a divisão da receita a percentual fixo: nenhum
   * número único é seguro em 10 TB e justo em 100 GB. Em 31/08/2026 o Felipe
   * pediu a receita cheia, viu que da faixa de 2 TB para cima a metade dele não
   * cobria a fatura (R$ 5.501,75 de descoberto num ano de 10 TB), e voltou para
   * cá. O caminho de volta continua sendo uma palavra em `BASE_DO_SPLIT`.
   */
  const razao = BASE_DO_SPLIT === "receita" ? 1 : Math.max(0, Math.min(1, lucro / liquido));

  /*
   * Quanto CADA SÓCIO leva, em centavos, antes de virar percentual.
   *
   * `proporcional`: a fatia dele sobre o que sobrou depois do custo.
   * `igual`:        a fatia dele sobre o líquido, MENOS um terço do custo.
   *
   * A conta é feita para os TRÊS, e não só para quem tem carteira: o terço do
   * custo é do sócio, exista carteira ou não. Quem ainda não se cadastrou
   * simplesmente não recebe agora — o dinheiro dele espera na conta em vez de
   * engordar a fatia dos outros.
   */
  const custo = Math.max(0, liquido - lucro);
  const terco = custo / SOCIOS.length;

  let brutos = SOCIOS.map((s) =>
    RATEIO_DO_CUSTO === "igual" && BASE_DO_SPLIT === "lucro"
      ? /* Trava em zero: um terço do custo pode passar da fatia de quem tem 25%,
           e aí ele deveria PAGAR — o que um split não sabe fazer. */
        Math.max(0, (liquido * s.percentual) / 100 - terco)
      : (liquido * s.percentual * razao) / 100,
  );

  /*
   * Travar em zero SOBE a soma, e a soma não pode passar do lucro: o que passar
   * sai da reserva, que é o dinheiro da Backblaze e da Cloudflare. Sem a trava a
   * soma seria exatamente o lucro (as fatias somam 100%), então só há excedente
   * quando alguém foi travado — e aí ele sai de quem ainda tem de onde, na
   * proporção do que cada um ia levar.
   */
  const soma = brutos.reduce((t, v) => t + v, 0);
  if (soma > lucro && soma > 0) {
    const fator = lucro / soma;
    brutos = brutos.map((v) => v * fator);
  }

  /*
   * A conta do percentual é feita em CENTÉSIMOS DE PONTO, em inteiro.
   *
   * Somar `35.49 + 10.49 + 10.49` em ponto flutuante dá 56.470000000000006, e o
   * resto calculado a partir daí virava 43.52 em vez de 43.53 — split de 99,99%,
   * um centésimo de ponto sumindo sem dono. Em inteiro a soma fecha sempre.
   */
  let distribuidoCentesimos = 0;
  SOCIOS.forEach((socio, i) => {
    const carteira = process.env[socio.variavelCarteira];
    if (!carteira) return;
    /* Para baixo, sempre: a sobra do arredondamento vai para a reserva. */
    const centesimos = Math.floor((brutos[i] / liquido) * 10000);
    if (centesimos <= 0) return;
    distribuidoCentesimos += centesimos;
    const percentual = centesimos / 100;
    fatias.push({
      socio,
      carteira,
      percentual,
      centavos: Math.floor((liquido * percentual) / 100),
    });
  });

  /*
   * A reserva vai para o caixa da operação, se ele existir — e leva junto a
   * sobra do arredondamento, para a soma fechar exatamente 100%. Sem carteira
   * de operação nada disso é enviado, e o Asaas deixa o não distribuído na
   * conta principal sozinho: é o mesmo dinheiro, no mesmo lugar de sempre.
   */
  const carteiraOperacao = process.env[VARIAVEL_CARTEIRA_OPERACAO];
  const resto = (10000 - distribuidoCentesimos) / 100;
  if (carteiraOperacao && resto > 0) {
    fatias.push({
      socio: OPERACAO,
      carteira: carteiraOperacao,
      percentual: resto,
      centavos: Math.floor((liquido * resto) / 100),
    });
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
