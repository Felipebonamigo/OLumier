/**
 * CUSTOS FIXOS — o que se paga todo mês mesmo sem nenhum cliente.
 *
 * ── Por que isto NÃO mora em `planos.ts` ──────────────────────────────────
 * `custoArmazenamentoCentavos` conta B2 e R2, e mais nada. DAS-MEI, VPS e
 * domínio ficaram de fora de propósito: eles não crescem com GB. Somar R$ 80 ao
 * plano de 100 GB o faria parecer prejuízo, e diluir o mesmo valor entre os
 * clientes mudaria o custo de TODO MUNDO a cada cliente novo — um custo por
 * plano que se mexe sozinho não serve para decidir preço.
 *
 * A pergunta que estes custos respondem é outra, e não existia em arquivo
 * nenhum: **quantos clientes pagam a operação?** É a conta de ponto de
 * equilíbrio, e é ela que diz se o negócio se paga — não a margem de um plano.
 *
 * ── Nada aqui é consumido pelo app ───────────────────────────────────────
 * Nenhuma tela, cobrança ou split lê este arquivo. É ferramenta de decisão, e
 * `scripts/ponto-de-equilibrio.mjs` é quem a imprime. Mora em `config/` para
 * ser testável e para os números terem um lugar só — não para ser importado por
 * rota nenhuma.
 */
import {
  ESPACOS,
  custoArmazenamentoCentavos,
  montar,
  type Montagem,
} from "./planos";
import { TAXA_COBRANCA } from "./socios";

export interface CustoFixo {
  id: string;
  nome: string;
  centavosPorMes: number;
  /**
   * `false` = estimativa, ainda não conferida num documento real.
   *
   * O campo existe porque estimativa que não se anuncia vira verdade em três
   * semanas: alguém lê a tabela, decide preço em cima e ninguém lembra de onde
   * o número veio. O relatório destaca os não confirmados em vez de somá-los
   * calado com os outros.
   */
  confirmado: boolean;
  /** De onde o número veio, ou onde conferi-lo. */
  nota: string;
}

/**
 * A lista. Valores em centavos por mês.
 *
 * O VPS e o DAS-MEI são COMPARTILHADOS com o Atomatiza (mesmo servidor, mesmo
 * CNPJ) e entram aqui INTEIROS, não rateados. Ratear exigiria escolher um
 * critério — por site? por receita? por disco? — e qualquer escolha seria um
 * chute que reduz o custo no papel. Inteiro é o número conservador: se o
 * Olumier se paga sozinho carregando a conta toda, se paga em qualquer rateio.
 */
export const CUSTOS_FIXOS: CustoFixo[] = [
  {
    id: "das-mei",
    nome: "DAS-MEI",
    centavosPorMes: 7600,
    confirmado: false,
    nota: "Estimativa: o valor muda todo ano com o salário mínimo. Conferir no carnê do MEI. Compartilhado com o Atomatiza (mesmo CNPJ) e contado inteiro aqui.",
  },
  {
    id: "vps",
    nome: "VPS Hostinger KVM2",
    centavosPorMes: 5000,
    confirmado: false,
    nota: "Estimativa: conferir na fatura da Hostinger. O servidor hospeda 13 sites (Atomatiza, Padelizou, este e outros); entra inteiro de propósito, ver o comentário acima.",
  },
  {
    id: "dominio",
    nome: "Domínio olumier.com.br",
    centavosPorMes: 333,
    confirmado: false,
    nota: "Estimativa: ~R$ 40/ano no Registro.br, diluídos em 12 meses. Conferir na renovação. É o único item 100% do Olumier.",
  },
  {
    id: "contabilidade",
    nome: "Contabilidade",
    centavosPorMes: 0,
    confirmado: true,
    nota: "MEI não exige contador, então hoje é zero de verdade. Vira custo real no dia em que a empresa virar ME — e é a hora de rever esta conta inteira.",
  },
];

export function custoFixoMensalCentavos(): number {
  return CUSTOS_FIXOS.reduce((s, c) => s + c.centavosPorMes, 0);
}

/** Os itens que ainda são chute meu — o relatório precisa gritá-los. */
export function custosPorConfirmar(): CustoFixo[] {
  return CUSTOS_FIXOS.filter((c) => !c.confirmado);
}

/*
 * IOF e spread do cartão.
 *
 * Cloudflare e Backblaze cobram em dólar num cartão brasileiro, então a fatura
 * traz duas linhas que o preço em dólar não mostra: o IOF sobre compra
 * internacional e a diferença entre a cotação do cartão e o dólar comercial.
 *
 * Em `planos.ts` eles NÃO entram — lá a folga cambial de 30% os cobre com
 * sobra. Aqui entram, porque ponto de equilíbrio calculado sem eles seria
 * otimista justamente no item que a fatura cobra sem avisar.
 *
 * ⚠️ ESTIMATIVA. O IOF sobre cartão internacional muda por decreto, e o spread
 * varia por operadora. Os dois números certos estão na SUA fatura: procure a
 * linha de IOF e a cotação usada. Se divergirem muito daqui, corrija estas duas
 * constantes — é o único lugar em que elas aparecem.
 */
export const IOF = 0.035;
export const SPREAD_CARTAO = 0.03;

/**
 * Custo variável de UM cliente, em centavos por mês.
 *
 * Armazenamento com IOF e câmbio por cima, mais a taxa da cobrança.
 *
 * `ocupacao` é a fração do espaço contratado que está guardada de verdade. O
 * padrão é 1 (contratou 1 TB, guardou 1 TB) porque é o pior caso; a ocupação
 * real de um estúdio fica entre 30% e 60%, e a diferença muda o resultado desta
 * conta pela metade. A taxa do Asaas NÃO escala com ocupação: é por cobrança.
 */
export function custoVariavelRealCentavos(m: Montagem, ocupacao = 1): number {
  const armazenamento = custoArmazenamentoCentavos(m) * ocupacao;
  return armazenamento * (1 + IOF) * (1 + SPREAD_CARTAO) + TAXA_COBRANCA;
}

/** Quanto sobra de cada cliente para pagar o custo fixo. */
export function margemPorClienteCentavos(
  m: Montagem,
  opcoes: { precoCentavos?: number; ocupacao?: number } = {},
): number {
  const preco = opcoes.precoCentavos ?? montar(m).precoCentavos;
  return preco - custoVariavelRealCentavos(m, opcoes.ocupacao ?? 1);
}

/**
 * Quantos clientes desta faixa pagam o custo fixo do mês.
 *
 * Devolve `null` quando a margem não é positiva. Um número negativo aqui seria
 * pior que nada: `ceil(custoFixo / -500)` dá "−7 clientes", que numa tabela se
 * lê como se a conta já fechasse.
 */
export function clientesParaEquilibrio(
  m: Montagem,
  opcoes: { precoCentavos?: number; ocupacao?: number } = {},
): number | null {
  const margem = margemPorClienteCentavos(m, opcoes);
  if (margem <= 0) return null;
  return Math.ceil(custoFixoMensalCentavos() / margem);
}

/** Uma linha do relatório, por faixa da grade. */
export interface LinhaEquilibrio {
  gb: number;
  precoCentavos: number;
  custoVariavelCentavos: number;
  margemCentavos: number;
  clientes: number | null;
}

export function tabelaDeEquilibrio(ocupacao = 1): LinhaEquilibrio[] {
  return ESPACOS.map((e) => {
    const m: Montagem = { segmento: "foto", espacoGb: e.gb };
    return {
      gb: e.gb,
      precoCentavos: e.precoCentavos,
      custoVariavelCentavos: Math.round(custoVariavelRealCentavos(m, ocupacao)),
      margemCentavos: Math.round(margemPorClienteCentavos(m, { ocupacao })),
      clientes: clientesParaEquilibrio(m, { ocupacao }),
    };
  });
}
