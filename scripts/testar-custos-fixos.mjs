#!/usr/bin/env node
/**
 * Testa a conta de ponto de equilíbrio — quantos clientes pagam a operação.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-custos-fixos.mjs
 *
 * Por que existe: `custoArmazenamentoCentavos` conta B2 e R2 e mais nada. DAS-MEI,
 * VPS e domínio não estavam em lugar nenhum do sistema — e não podem entrar no
 * custo por plano, porque não crescem com GB: somar R$ 80 ao plano de 100 GB o
 * faria parecer prejuízo, e diluir entre clientes mudaria o custo de todo mundo
 * a cada cliente novo.
 *
 * O lugar certo deles é esta conta: com o custo fixo X e a margem Y por cliente,
 * quantos clientes fecham a conta. É a pergunta que decide se o negócio se paga,
 * e ela não existia em nenhum arquivo.
 *
 * Suíte PURA: sem banco, sem servidor, sem rede.
 */
import {
  CUSTOS_FIXOS,
  IOF,
  SPREAD_CARTAO,
  custoFixoMensalCentavos,
  custosPorConfirmar,
  custoVariavelRealCentavos,
  custoTotalPorClienteCentavos,
  lucroTotalPorClienteCentavos,
  margemPorClienteCentavos,
  clientesParaEquilibrio,
} from "../src/config/custos-fixos.ts";
import { custoArmazenamentoCentavos, montar, ESPACOS } from "../src/config/planos.ts";
import { taxaCobrancaCentavos } from "../src/config/socios.ts";

/*
 * A MENOR faixa da grade, lida da tabela em vez de cravada.
 *
 * Era 100 GB escrito à mão. A faixa saiu em 04/09/2026 (o GoFotógrafo dá 300 GB
 * mais um CRM pelo mesmo dinheiro), e o teste quebrou apontando para um espaço
 * que não existe mais. O que estas etapas provam não é sobre 100 GB: é que a
 * conta devolve prejuízo de verdade quando o preço não cobre o custo — e a
 * menor faixa, seja qual for, é onde a margem é mais apertada.
 */
const MENOR_FAIXA = Math.min(...ESPACOS.map((e) => e.gb));

/* A taxa do Asaas deixou de ser um valor fixo em 05/09/2026: é R$ 0,49 + 2,99%
   sobre o preço, que é o que o cartão cobra. Aqui ela sai do plano de 1 TB, que
   é o usado nas duas etapas abaixo. */
const TAXA_DO_PLANO = taxaCobrancaCentavos(
  montar({ segmento: "foto", espacoGb: 1000 }).precoCentavos,
);

let falhou = false;
async function etapa(nome, fn) {
  try {
    const detalhe = await fn();
    console.log(`  ✓ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

console.log("os custos fixos");

await etapa("o total é a soma dos itens", () => {
  const soma = CUSTOS_FIXOS.reduce((s, c) => s + c.centavosPorMes, 0);
  igual(custoFixoMensalCentavos(), soma, "total");
  if (soma <= 0) throw new Error("custo fixo zerado — a lista está vazia?");
  return `R$ ${(soma / 100).toFixed(2)} entre ${CUSTOS_FIXOS.length} itens`;
});

/*
 * ESTIMATIVA TEM DE SE ANUNCIAR.
 *
 * Metade destes valores é chute meu: o DAS-MEI muda com o salário mínimo todo
 * ano, e o preço do VPS só está na fatura da Hostinger. Um número estimado que
 * não se identifica vira verdade em três semanas — alguém lê a tabela, decide
 * preço em cima e ninguém lembra de onde o número veio.
 *
 * Este teste não exige que tudo esteja confirmado (não estaria hoje). Exige que
 * o campo EXISTA em todo item, para o relatório poder gritar quais são chute.
 */
await etapa("todo item diz se é valor confirmado ou estimativa", () => {
  for (const c of CUSTOS_FIXOS) {
    if (typeof c.confirmado !== "boolean") throw new Error(`${c.id}: sem o campo confirmado`);
    if (!c.nota || c.nota.length < 10) throw new Error(`${c.id}: sem nota explicando de onde vem`);
  }
  const chutes = custosPorConfirmar();
  return chutes.length > 0
    ? `${chutes.length} a confirmar: ${chutes.map((c) => c.id).join(", ")}`
    : "todos confirmados";
});

console.log("\ncusto variável de um cliente");

/*
 * O custo variável desta conta é MAIOR que o de `planos.ts`, e tem de ser: aqui
 * entram o IOF e o spread do cartão, que lá ficam por conta da folga cambial.
 * Ponto de equilíbrio calculado sem eles seria otimista justamente no item que
 * a fatura cobra sem avisar.
 */
await etapa("o custo variável inclui IOF e spread do cartão", () => {
  const m = { segmento: "foto", espacoGb: 1000 };
  const soArmazenamento = custoArmazenamentoCentavos(m);
  const real = custoVariavelRealCentavos(m);
  if (real <= soArmazenamento + TAXA_DO_PLANO) {
    throw new Error(`R$ ${(real / 100).toFixed(2)} não cobre armazenamento + taxa + IOF/câmbio`);
  }
  const esperado = soArmazenamento * (1 + IOF) * (1 + SPREAD_CARTAO) + TAXA_DO_PLANO;
  if (Math.abs(real - esperado) > 1) {
    throw new Error(`esperava ~R$ ${(esperado / 100).toFixed(2)}, veio R$ ${(real / 100).toFixed(2)}`);
  }
  return `R$ ${(real / 100).toFixed(2)} contra R$ ${(soArmazenamento / 100).toFixed(2)} só de armazenamento`;
});

/*
 * Ocupação é o que separa o teto do provável. O custo do fornecedor é pelo que
 * está guardado de verdade, e a conta cheia é o pior caso — não o esperado.
 */
await etapa("meia ocupação custa menos que o teto", () => {
  const m = { segmento: "foto", espacoGb: 1000 };
  const cheio = custoVariavelRealCentavos(m, 1);
  const meio = custoVariavelRealCentavos(m, 0.5);
  if (meio >= cheio) throw new Error("ocupação não muda o custo");
  /* A taxa do Asaas não escala com ocupação: ela é por cobrança. */
  if (meio <= TAXA_DO_PLANO) throw new Error("a taxa da cobrança sumiu do cálculo");
  return `R$ ${(cheio / 100).toFixed(2)} cheio · R$ ${(meio / 100).toFixed(2)} pela metade`;
});

console.log("\nponto de equilíbrio");

await etapa("a margem é o preço menos o custo variável", () => {
  for (const e of ESPACOS) {
    const m = { segmento: "foto", espacoGb: e.gb };
    const margem = margemPorClienteCentavos(m);
    igual(margem, e.precoCentavos - custoVariavelRealCentavos(m), `margem de ${e.gb} GB`);
    if (margem <= 0) throw new Error(`${e.gb} GB tem margem ${margem} — o preço não cobre o custo`);
  }
  return `${ESPACOS.length} faixas, todas com margem positiva`;
});

/*
 * Faixa maior tem margem maior em REAIS (não em percentual — o R$/GB cai de
 * propósito). Logo, quanto maior a faixa, menos clientes fecham a conta.
 */
await etapa("faixa maior precisa de menos clientes", () => {
  let anterior = Infinity;
  const linhas = [];
  for (const e of ESPACOS) {
    const n = clientesParaEquilibrio({ segmento: "foto", espacoGb: e.gb });
    if (n === null) throw new Error(`${e.gb} GB não fecha a conta em cliente nenhum`);
    if (n > anterior) throw new Error(`${e.gb} GB precisa de MAIS clientes que a faixa anterior`);
    anterior = n;
    linhas.push(`${e.gb}=${n}`);
  }
  return linhas.join(" · ");
});

await etapa("nunca devolve zero clientes", () => {
  for (const e of ESPACOS) {
    const n = clientesParaEquilibrio({ segmento: "foto", espacoGb: e.gb });
    if (n < 1) throw new Error(`${e.gb} GB devolveu ${n} — custo fixo não se paga sozinho`);
  }
});

/*
 * Margem negativa não pode virar um número que engana. `ceil(fixo / -500)` é
 * negativo, e um "−7 clientes" numa tabela lê-se como se a conta já fechasse.
 * Null obriga quem chama a tratar o caso.
 */
await etapa("margem negativa devolve null, não número negativo", () => {
  const impossivel = montar({ segmento: "foto", espacoGb: MENOR_FAIXA });
  const n = clientesParaEquilibrio(
    { segmento: "foto", espacoGb: MENOR_FAIXA },
    { precoCentavos: 1 }, // um centavo: jamais cobre o custo variável
  );
  if (n !== null) throw new Error(`esperava null, veio ${n} (preço de R$ 0,01)`);
  return `${impossivel.nome} a R$ 0,01 não fecha, e diz isso`;
});

console.log("\ncusto TOTAL por cliente");

/*
 * O custo total é o variável mais a FATIA do custo fixo — e a fatia depende de
 * quantos clientes existem. Sem essa divisão, "custo total" não tem valor
 * único, e é exatamente por isso que o custo fixo não pode morar em
 * `planos.ts`: lá não há como saber quantos clientes há.
 */
await etapa("custo total é o variável mais a fatia do custo fixo", () => {
  const m = { segmento: "foto", espacoGb: 1000 };
  for (const clientes of [1, 4, 25]) {
    const total = custoTotalPorClienteCentavos(m, { clientes });
    const esperado = custoVariavelRealCentavos(m) + custoFixoMensalCentavos() / clientes;
    if (Math.abs(total - esperado) > 1) {
      throw new Error(`${clientes} clientes: esperava ${esperado.toFixed(0)}, veio ${total.toFixed(0)}`);
    }
  }
  return "confere em 1, 4 e 25 clientes";
});

await etapa("mais clientes diluem o custo fixo", () => {
  const m = { segmento: "foto", espacoGb: 1000 };
  let anterior = Infinity;
  for (const clientes of [1, 2, 5, 10, 50]) {
    const total = custoTotalPorClienteCentavos(m, { clientes });
    if (total >= anterior) throw new Error(`${clientes} clientes não baratearam o custo`);
    anterior = total;
  }
  /* Nunca abaixo do variável: o custo fixo dilui, não desaparece. */
  const limite = custoVariavelRealCentavos(m);
  if (custoTotalPorClienteCentavos(m, { clientes: 1e6 }) <= limite) {
    throw new Error("o custo total caiu abaixo do variável — a fatia fixa virou negativa?");
  }
});

/*
 * PREJUÍZO TEM DE APARECER COMO PREJUÍZO.
 *
 * Um cliente só de 100 GB rende R$ 41,11 e a operação custa R$ 129,33: o mês
 * fecha no vermelho. `lucroCentavos` em `socios.ts` trava em zero de propósito
 * (lá o número vira repasse, e repasse negativo não existe), mas AQUI travar
 * seria mentir numa tabela de decisão — "lucro R$ 0,00" lê-se como empate.
 */
await etapa("lucro negativo sai negativo, não travado em zero", () => {
  const lucro = lucroTotalPorClienteCentavos({ segmento: "foto", espacoGb: MENOR_FAIXA }, { clientes: 1 });
  if (lucro >= 0) throw new Error(`um cliente da menor faixa deveria dar prejuízo, veio ${lucro}`);
  return `R$ ${(lucro / 100).toFixed(2)} com um cliente só`;
});

/*
 * A ponte entre as duas contas: no número de clientes que `clientesParaEquilibrio`
 * devolve, o lucro por cliente tem de ter virado positivo — e um cliente a menos
 * ainda tem de estar no vermelho. Se as duas funções discordarem, uma delas está
 * errada, e é dinheiro.
 */
await etapa("o equilíbrio bate com o lucro por cliente", () => {
  for (const e of ESPACOS) {
    const m = { segmento: "foto", espacoGb: e.gb };
    const n = clientesParaEquilibrio(m);
    if (lucroTotalPorClienteCentavos(m, { clientes: n }) < 0) {
      throw new Error(`${e.gb} GB: ainda no vermelho com ${n} clientes`);
    }
    if (n > 1 && lucroTotalPorClienteCentavos(m, { clientes: n - 1 }) >= 0) {
      throw new Error(`${e.gb} GB: ${n - 1} clientes já bastariam — o equilíbrio está alto`);
    }
  }
  return `${ESPACOS.length} faixas conferidas nos dois lados`;
});

console.log(falhou ? "\n✗ a conta de custos fixos tem problema\n" : "\n✓ custos fixos ok\n");
process.exit(falhou ? 1 : 0);
