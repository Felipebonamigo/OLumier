/**
 * O CAIXA DOS SÓCIOS — o dinheiro dos dois produtos, lido do Asaas.
 *
 * Felipe, 29/09/2026: "talvez seja melhor unificar em uma página admin os
 * custos, receitas e etc, falando de atomatiza e galeria juntos. Porque é os
 * mesmos 3 sócios nos 2 sistemas. Só muda a porcentagem de cada um para cada
 * sistema."
 *
 * ── POR QUE O ASAAS, E NÃO O BANCO DE CADA PRODUTO ────────────────────────
 *
 * Os dois produtos cobram pela MESMA conta do Asaas, e é lá que o dinheiro de
 * verdade está: o valor pago (já com o desconto do pacote), a taxa, o líquido
 * e — o que nenhum banco nosso sabe — quanto o split mandou para a carteira de
 * cada sócio. O painel da Galeria calcula a receita pelo preço de tabela; o do
 * Atomatiza também. Os dois erram para cima em todo cliente do pacote, e
 * nenhum dos dois conhece a divisão entre sócios. Aqui não há conta a fazer:
 * é somar o que o Asaas registrou.
 *
 * De que produto é cada pagamento diz o `externalReference`, que os dois
 * sempre preenchem: `olumier:` é da Galeria, `atz:` é do Atomatiza. Pagamento
 * sem nenhum dos dois (uma cobrança lançada à mão no painel do Asaas) fica
 * numa coluna própria, em vez de engordar um dos lados.
 *
 * ── A PORCENTAGEM DE CADA SÓCIO É A QUE ACONTECEU ─────────────────────────
 *
 * O acordo da Galeria está em `config/socios.ts` (50/25/25 do lucro). O do
 * Atomatiza mora só no servidor de lá (`ASAAS_SOCIOS`). Em vez de repetir os
 * dois aqui — e ter três cópias para envelhecer —, a página mostra o que o
 * split DE FATO repassou, em reais e em porcentagem do líquido de cada
 * produto. Se o acordo mudar num lado e a configuração não, a diferença
 * aparece aqui.
 *
 * Tudo em centavos. Sem banco e sem rede: quem busca é `lib/asaas.ts`.
 */

import { SOCIOS, OPERACAO } from "@/config/socios";

export type Sistema = "galeria" | "atomatiza" | "outros";
export const SISTEMAS: Sistema[] = ["galeria", "atomatiza", "outros"];
export const NOME_DO_SISTEMA: Record<Sistema, string> = {
  galeria: "Galeria Átomo",
  atomatiza: "Atomatiza",
  outros: "Sem produto",
};

/** Uma entrada do split, como o Asaas devolve junto com o pagamento. */
export interface RepasseDoAsaas {
  walletId?: string | null;
  fixedValue?: number | null;
  percentualValue?: number | null;
  totalValue?: number | null;
  status?: string | null;
}

/** Os campos do pagamento que o caixa usa. */
export interface PagamentoDoAsaas {
  id: string;
  status: string;
  value: number;
  netValue?: number | null;
  billingType?: string | null;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  estimatedCreditDate?: string | null;
  externalReference?: string | null;
  description?: string | null;
  split?: RepasseDoAsaas[] | null;
}

/** Pago e já na conta. `CONFIRMED` (cartão aprovado, ainda não liberado) fica em "a receber". */
export const STATUS_RECEBIDO = new Set(["RECEIVED", "RECEIVED_IN_CASH"]);

/** Repasse que não saiu: o dinheiro ficou na conta principal. */
const REPASSE_QUE_NAO_SAIU = new Set(["CANCELLED", "REFUSED", "BLOCKED_BY_VALUE_DIVERGENCE"]);

export function sistemaDaReferencia(referencia: string | null | undefined): Sistema {
  if (referencia?.startsWith("olumier:")) return "galeria";
  if (referencia?.startsWith("atz:")) return "atomatiza";
  return "outros";
}

const centavos = (reais: number | null | undefined) =>
  typeof reais === "number" && Number.isFinite(reais) ? Math.round(reais * 100) : 0;

/**
 * Quanto um repasse mandou. `totalValue` é o valor final que o Asaas calculou;
 * sem ele (resposta antiga, ou repasse ainda pendente), vale o fixo, e por
 * último o percentual sobre o líquido — que é sobre o que o Asaas aplica.
 */
export function centavosDoRepasse(r: RepasseDoAsaas, liquidoCentavos: number): number {
  if (typeof r.totalValue === "number" && Number.isFinite(r.totalValue)) return centavos(r.totalValue);
  if (typeof r.fixedValue === "number" && Number.isFinite(r.fixedValue)) return centavos(r.fixedValue);
  if (typeof r.percentualValue === "number" && Number.isFinite(r.percentualValue)) {
    return Math.floor((liquidoCentavos * r.percentualValue) / 100);
  }
  return 0;
}

/** Uma carteira com nome — a dos sócios e a do caixa da operação, lidas do ambiente. */
export interface Carteira {
  walletId: string;
  nome: string;
  tipo: "socio" | "operacao";
}

/** As carteiras que a Galeria conhece (`ASAAS_CARTEIRA_*`). */
export function carteirasConhecidas(env: Record<string, string | undefined> = process.env): Carteira[] {
  const lista: Carteira[] = [];
  for (const s of SOCIOS) {
    const w = env[s.variavelCarteira]?.trim();
    if (w) lista.push({ walletId: w, nome: s.nome, tipo: "socio" });
  }
  const op = env[OPERACAO.variavelCarteira]?.trim();
  if (op) lista.push({ walletId: op, nome: OPERACAO.nome, tipo: "operacao" });
  return lista;
}

export type TipoDoDestino = "socio" | "operacao" | "desconhecida" | "conta";

export interface Destino {
  chave: string;
  nome: string;
  tipo: TipoDoDestino;
  /** Sócio sem carteira configurada aqui: o que é dele não tem como aparecer na linha dele. */
  semCarteira?: boolean;
}

const porSistemaZerado = (): Record<Sistema, number> => ({ galeria: 0, atomatiza: 0, outros: 0 });

export interface NumerosDoSistema {
  pagamentos: number;
  brutoCentavos: number;
  /** O que o Asaas descontou: bruto menos líquido. */
  taxaCentavos: number;
  liquidoCentavos: number;
  repassadoCentavos: number;
  /** Líquido menos o que foi repassado: o que ficou na conta principal. */
  naContaCentavos: number;
}

const numerosZerados = (): NumerosDoSistema => ({
  pagamentos: 0,
  brutoCentavos: 0,
  taxaCentavos: 0,
  liquidoCentavos: 0,
  repassadoCentavos: 0,
  naContaCentavos: 0,
});

export interface LinhaDoPagamento {
  id: string;
  dia: string | null;
  sistema: Sistema;
  descricao: string;
  forma: string;
  brutoCentavos: number;
  liquidoCentavos: number;
  repasses: { nome: string; centavos: number; saiu: boolean }[];
}

export interface CaixaDoMes {
  porSistema: Record<Sistema, NumerosDoSistema>;
  total: NumerosDoSistema;
  /** Uma linha por destino do dinheiro — sócios, caixa da operação, carteira desconhecida, conta principal. */
  destinos: { destino: Destino; porSistema: Record<Sistema, number>; totalCentavos: number }[];
  /** Repasses que o Asaas cancelou ou recusou: o dinheiro deles ficou na conta. */
  repassesQueNaoSairam: number;
  pagamentos: LinhaDoPagamento[];
}

const FORMA: Record<string, string> = {
  PIX: "Pix",
  BOLETO: "Boleto",
  CREDIT_CARD: "Cartão",
  DEBIT_CARD: "Débito",
  UNDEFINED: "—",
};

const finalDaCarteira = (w: string) => `Carteira …${w.slice(-6)}`;

/**
 * O caixa de um período, a partir dos pagamentos que o Asaas devolveu.
 *
 * Só entram os já recebidos (`STATUS_RECEBIDO`) — quem chama pode mandar a
 * lista crua. Os três sócios aparecem sempre, mesmo com zero: "a Carol não
 * recebeu nada da Galeria" é informação, e linha que some não diz nada.
 */
export function montarCaixa(pagamentos: PagamentoDoAsaas[], carteiras: Carteira[]): CaixaDoMes {
  const porSistema: Record<Sistema, NumerosDoSistema> = {
    galeria: numerosZerados(),
    atomatiza: numerosZerados(),
    outros: numerosZerados(),
  };

  const porCarteira = new Map(carteiras.map((c) => [c.walletId, c]));
  const destinos = new Map<string, { destino: Destino; porSistema: Record<Sistema, number> }>();
  for (const s of SOCIOS) {
    const c = carteiras.find((x) => x.tipo === "socio" && x.nome === s.nome);
    destinos.set(c ? c.walletId : `socio:${s.id}`, {
      destino: { chave: s.id, nome: s.nome, tipo: "socio", semCarteira: !c },
      porSistema: porSistemaZerado(),
    });
  }
  const destinoDe = (walletId: string) => {
    let d = destinos.get(walletId);
    if (!d) {
      const c = porCarteira.get(walletId);
      d = {
        destino: c
          ? { chave: walletId, nome: c.nome, tipo: c.tipo }
          : { chave: walletId, nome: finalDaCarteira(walletId), tipo: "desconhecida" },
        porSistema: porSistemaZerado(),
      };
      destinos.set(walletId, d);
    }
    return d;
  };

  let repassesQueNaoSairam = 0;
  const linhas: LinhaDoPagamento[] = [];

  for (const p of pagamentos) {
    if (!STATUS_RECEBIDO.has(p.status)) continue;
    const sistema = sistemaDaReferencia(p.externalReference);
    const bruto = centavos(p.value);
    const liquido = typeof p.netValue === "number" ? centavos(p.netValue) : bruto;

    const repasses: LinhaDoPagamento["repasses"] = [];
    let repassado = 0;
    for (const r of p.split ?? []) {
      if (!r?.walletId) continue;
      const valor = centavosDoRepasse(r, liquido);
      const saiu = !REPASSE_QUE_NAO_SAIU.has(r.status ?? "");
      const d = destinoDe(r.walletId);
      repasses.push({ nome: d.destino.nome, centavos: valor, saiu });
      if (!saiu) {
        repassesQueNaoSairam += 1;
        continue;
      }
      d.porSistema[sistema] += valor;
      repassado += valor;
    }

    const n = porSistema[sistema];
    n.pagamentos += 1;
    n.brutoCentavos += bruto;
    n.taxaCentavos += bruto - liquido;
    n.liquidoCentavos += liquido;
    n.repassadoCentavos += repassado;
    n.naContaCentavos += liquido - repassado;

    linhas.push({
      id: p.id,
      dia: p.paymentDate ?? p.clientPaymentDate ?? null,
      sistema,
      descricao: p.description?.trim() || "(sem descrição)",
      forma: FORMA[p.billingType ?? ""] ?? p.billingType ?? "—",
      brutoCentavos: bruto,
      liquidoCentavos: liquido,
      repasses,
    });
  }

  const total = numerosZerados();
  for (const s of SISTEMAS) {
    for (const k of Object.keys(total) as (keyof NumerosDoSistema)[]) total[k] += porSistema[s][k];
  }

  const ordem: Record<TipoDoDestino, number> = { socio: 0, operacao: 1, desconhecida: 2, conta: 3 };
  const lista = [...destinos.values()]
    .sort((a, b) => ordem[a.destino.tipo] - ordem[b.destino.tipo])
    .map((d) => ({ ...d, totalCentavos: SISTEMAS.reduce((s, k) => s + d.porSistema[k], 0) }));

  const conta = porSistemaZerado();
  for (const s of SISTEMAS) conta[s] = porSistema[s].naContaCentavos;
  lista.push({
    destino: { chave: "conta", nome: "Ficou na conta principal", tipo: "conta" },
    porSistema: conta,
    totalCentavos: total.naContaCentavos,
  });

  linhas.sort((a, b) => (b.dia ?? "").localeCompare(a.dia ?? ""));
  return { porSistema, total, destinos: lista, repassesQueNaoSairam, pagamentos: linhas };
}

export interface AReceber {
  porSistema: Record<Sistema, { pagamentos: number; liquidoCentavos: number }>;
  totalCentavos: number;
  /** A data de liberação mais distante — até quando o que foi pago no cartão termina de cair. */
  ultimaLiberacao: string | null;
}

/** Cartão aprovado que o Asaas ainda não liberou (`CONFIRMED`). */
export function somarAReceber(pagamentos: PagamentoDoAsaas[]): AReceber {
  const porSistema = {
    galeria: { pagamentos: 0, liquidoCentavos: 0 },
    atomatiza: { pagamentos: 0, liquidoCentavos: 0 },
    outros: { pagamentos: 0, liquidoCentavos: 0 },
  };
  let total = 0;
  let ultima: string | null = null;
  for (const p of pagamentos) {
    if (p.status !== "CONFIRMED") continue;
    const s = porSistema[sistemaDaReferencia(p.externalReference)];
    const liquido = typeof p.netValue === "number" ? centavos(p.netValue) : centavos(p.value);
    s.pagamentos += 1;
    s.liquidoCentavos += liquido;
    total += liquido;
    if (p.estimatedCreditDate && (!ultima || p.estimatedCreditDate > ultima)) ultima = p.estimatedCreditDate;
  }
  return { porSistema, totalCentavos: total, ultimaLiberacao: ultima };
}

// --- o mês ------------------------------------------------------------------

const MES = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-09" — ou null para qualquer outra coisa que chegue pelo endereço. */
export function mesValido(v: unknown): string | null {
  return typeof v === "string" && MES.test(v) ? v : null;
}

/** O mês de hoje em Brasília: às 22h do dia 30, ainda é o mês do dia 30. */
export function mesDeBrasilia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" })
    .format(agora)
    .slice(0, 7);
}

/** Primeiro e último dia do mês, no formato de data do Asaas. */
export function limitesDoMes(mes: string): { de: string; ate: string } {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

export function mesVizinho(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function nomeDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
