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
 * sempre preenchem: `olumier:` é da Galeria, `atz:` é do Atomatiza, `pacote:`
 * é a fatura única dos dois (`docs/pacote.md`). Pagamento sem nenhum deles
 * (uma cobrança lançada à mão no painel do Asaas) fica numa coluna própria, em
 * vez de engordar um dos lados. O pacote também tem a sua: o split dele junta
 * as fatias dos dois produtos numa linha por carteira, e separar de novo seria
 * inventar número.
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
 * ── A PARTE DO DONO DA CONTA ───────────────────────────────────────────────
 *
 * O Asaas não faz split para a própria carteira, então a fatia do Felipe —
 * dono da conta principal — nunca aparece como repasse: fica na conta. Lida ao
 * pé da letra, a tabela dizia "Felipe R$ 0,00" (Juan, 30/09/2026: "Felipe
 * ganhando 0 reais"). Agora a linha dele mostra a parte que ficou na conta, e
 * sai da linha da conta principal — a soma continua fechando no líquido:
 *
 *   · Galeria: pelo acordo de `config/socios.ts`, a partir do que os outros
 *     sócios receberam na mesma cobrança (50/25/25: o dobro da Carol). É
 *     estimativa — o Asaas arredonda cada fatia —, e a página diz isso.
 *   · Atomatiza: tudo o que não foi repassado. Lá a divisão é sobre a receita,
 *     sem reserva de custo, e a sobra é a fatia de quem é dono da conta.
 *   · Pacote e sem produto: nada. No pacote a fatia do Felipe está misturada
 *     com a reserva da Galeria; o "sem produto" não é dinheiro dos sócios.
 *
 * Se um dia o dono tiver carteira própria e receber repasse de verdade num
 * produto, vale o repasse, e nada é estimado ali.
 *
 * Tudo em centavos. Sem banco e sem rede: quem busca é `lib/asaas.ts`.
 */

import { SOCIOS, OPERACAO, DONO_DA_CONTA_PRINCIPAL } from "@/config/socios";

export type Sistema = "galeria" | "atomatiza" | "pacote" | "outros";
export const SISTEMAS: Sistema[] = ["galeria", "atomatiza", "pacote", "outros"];
export const NOME_DO_SISTEMA: Record<Sistema, string> = {
  galeria: "Galeria Átomo",
  atomatiza: "Atomatiza",
  pacote: "Pacote (os dois)",
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
  /** Quando o cartão foi aprovado. */
  confirmedDate?: string | null;
  dateCreated?: string | null;
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
  /* O mesmo prefixo nos dois repositórios: `pacote:<galeria>:<estúdio>`. */
  if (referencia?.startsWith("pacote:")) return "pacote";
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
  /** O dono da conta principal: a parte dele fica na conta, em vez de sair em repasse. */
  donoDaConta?: boolean;
}

const porSistemaZerado = (): Record<Sistema, number> => ({ galeria: 0, atomatiza: 0, pacote: 0, outros: 0 });

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

export const FORMA: Record<string, string> = {
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
    pacote: numerosZerados(),
    outros: numerosZerados(),
  };

  const porCarteira = new Map(carteiras.map((c) => [c.walletId, c]));
  const destinos = new Map<string, { destino: Destino; porSistema: Record<Sistema, number> }>();
  for (const s of SOCIOS) {
    const c = carteiras.find((x) => x.tipo === "socio" && x.nome === s.nome);
    const dono = s.id === DONO_DA_CONTA_PRINCIPAL;
    destinos.set(c ? c.walletId : `socio:${s.id}`, {
      destino: {
        chave: s.id,
        nome: s.nome,
        tipo: "socio",
        /* Sem carteira, a parte do dono fica na conta do mesmo jeito: não é falta. */
        semCarteira: !c && !dono,
        ...(dono ? { donoDaConta: true } : {}),
      },
      porSistema: porSistemaZerado(),
    });
  }
  const dono = [...destinos.values()].find((d) => d.destino.donoDaConta) ?? null;
  const socioDaCarteira = new Map(
    carteiras.filter((c) => c.tipo === "socio").map((c) => [c.walletId, SOCIOS.find((s) => s.nome === c.nome)]),
  );
  const socioDono = SOCIOS.find((s) => s.id === DONO_DA_CONTA_PRINCIPAL);
  /** A parte do dono que ficou na conta, por produto (ver o topo do arquivo). */
  const doDonoNaConta = porSistemaZerado();
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
    let donoRecebeu = false;
    /* A fatia do dono pelo acordo, uma estimativa por sócio que recebeu. */
    const pelosOutros: number[] = [];
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
      if (d === dono) donoRecebeu = true;
      const socio = socioDaCarteira.get(r.walletId);
      if (socio && socioDono && socio.id !== socioDono.id && socio.percentual > 0) {
        pelosOutros.push((valor * socioDono.percentual) / socio.percentual);
      }
    }

    if (dono && !donoRecebeu) {
      const ficou = liquido - repassado;
      let parte = 0;
      if (sistema === "atomatiza") parte = ficou;
      else if (sistema === "galeria" && pelosOutros.length > 0) {
        parte = Math.round(pelosOutros.reduce((t, v) => t + v, 0) / pelosOutros.length);
      }
      doDonoNaConta[sistema] += Math.max(0, Math.min(ficou, parte));
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

  /* A parte do dono muda de linha: sai da conta principal e entra na dele. A
     soma das linhas continua sendo o líquido. */
  const conta = porSistemaZerado();
  for (const s of SISTEMAS) conta[s] = porSistema[s].naContaCentavos - doDonoNaConta[s];
  const linhaDoDono = lista.find((d) => d.destino.donoDaConta);
  if (linhaDoDono) {
    for (const s of SISTEMAS) linhaDoDono.porSistema[s] += doDonoNaConta[s];
    linhaDoDono.totalCentavos = SISTEMAS.reduce((t, k) => t + linhaDoDono.porSistema[k], 0);
  }
  lista.push({
    destino: { chave: "conta", nome: "Reserva de custo e o resto", tipo: "conta" },
    porSistema: conta,
    totalCentavos: SISTEMAS.reduce((t, k) => t + conta[k], 0),
  });

  linhas.sort((a, b) => (b.dia ?? "").localeCompare(a.dia ?? ""));
  return { porSistema, total, destinos: lista, repassesQueNaoSairam, pagamentos: linhas };
}

/** Um pagamento de cartão aprovado, esperando o Asaas liberar. */
export interface LinhaAReceber {
  id: string;
  sistema: Sistema;
  descricao: string;
  brutoCentavos: number;
  liquidoCentavos: number;
  /** Quando o cartão foi aprovado. */
  aprovadoEm: string | null;
  /** Quando o Asaas diz que o dinheiro cai na conta. */
  caiEm: string | null;
}

export interface AReceber {
  porSistema: Record<Sistema, { pagamentos: number; liquidoCentavos: number }>;
  totalCentavos: number;
  /** A data de liberação mais distante — até quando o que foi pago no cartão termina de cair. */
  ultimaLiberacao: string | null;
  /** Cada pagamento, do que cai primeiro para o que cai por último. */
  pagamentos: LinhaAReceber[];
  /** Quanto o dinheiro de cada cobrança espera, da aprovação até cair — a média, em dias. */
  diasAteCair: number | null;
  /** Quanto cai em cada mês ("2026-10"), em ordem. */
  porMes: { mes: string; pagamentos: number; liquidoCentavos: number }[];
}

const DIA_MS = 86_400_000;

/**
 * Cartão aprovado que o Asaas ainda não liberou (`CONFIRMED`).
 *
 * Juan, 30/09/2026, olhando o total: "é possível esse dado mostrar de onde tá
 * vindo isso e quantas entradas pendentes de cada plataforma?" — e "quando ele
 * libera?". Por isso a lista de cada pagamento, com a data que o PRÓPRIO Asaas
 * informa (`estimatedCreditDate`), e a espera média calculada dessas datas, em
 * vez de um prazo escrito aqui que pode mudar no contrato com o Asaas.
 */
export function somarAReceber(pagamentos: PagamentoDoAsaas[]): AReceber {
  const porSistema = {
    galeria: { pagamentos: 0, liquidoCentavos: 0 },
    atomatiza: { pagamentos: 0, liquidoCentavos: 0 },
    pacote: { pagamentos: 0, liquidoCentavos: 0 },
    outros: { pagamentos: 0, liquidoCentavos: 0 },
  };
  let total = 0;
  let ultima: string | null = null;
  const linhas: LinhaAReceber[] = [];
  const esperas: number[] = [];
  const meses = new Map<string, { pagamentos: number; liquidoCentavos: number }>();
  for (const p of pagamentos) {
    if (p.status !== "CONFIRMED") continue;
    const sistema = sistemaDaReferencia(p.externalReference);
    const s = porSistema[sistema];
    const liquido = typeof p.netValue === "number" ? centavos(p.netValue) : centavos(p.value);
    s.pagamentos += 1;
    s.liquidoCentavos += liquido;
    total += liquido;
    const caiEm = p.estimatedCreditDate?.slice(0, 10) || null;
    const aprovadoEm = (p.confirmedDate ?? p.clientPaymentDate ?? p.dateCreated)?.slice(0, 10) || null;
    if (caiEm && (!ultima || caiEm > ultima)) ultima = caiEm;
    if (caiEm && aprovadoEm) {
      const dias = Math.round((Date.parse(`${caiEm}T12:00:00Z`) - Date.parse(`${aprovadoEm}T12:00:00Z`)) / DIA_MS);
      if (Number.isFinite(dias) && dias >= 0) esperas.push(dias);
    }
    const chave = caiEm ? caiEm.slice(0, 7) : "";
    const m = meses.get(chave) ?? { pagamentos: 0, liquidoCentavos: 0 };
    m.pagamentos += 1;
    m.liquidoCentavos += liquido;
    meses.set(chave, m);
    linhas.push({
      id: p.id,
      sistema,
      descricao: p.description?.trim() || "(sem descrição)",
      brutoCentavos: centavos(p.value),
      liquidoCentavos: liquido,
      aprovadoEm,
      caiEm,
    });
  }
  /* Sem data de liberação vai para o fim: é o que menos se sabe quando cai. */
  linhas.sort((a, b) => (a.caiEm ?? "9999").localeCompare(b.caiEm ?? "9999") || a.id.localeCompare(b.id));
  const porMes = [...meses.entries()]
    .sort(([a], [b]) => (a || "9999").localeCompare(b || "9999"))
    .map(([mes, v]) => ({ mes, ...v }));
  return {
    porSistema,
    totalCentavos: total,
    ultimaLiberacao: ultima,
    pagamentos: linhas,
    diasAteCair: esperas.length ? Math.round(esperas.reduce((t, d) => t + d, 0) / esperas.length) : null,
    porMes,
  };
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
