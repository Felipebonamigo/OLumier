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
  margemPorClienteCentavos,
  clientesParaEquilibrio,
} from "../src/config/custos-fixos.ts";
import { custoArmazenamentoCentavos, montar, ESPACOS } from "../src/config/planos.ts";
import { TAXA_COBRANCA } from "../src/config/socios.ts";

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
  if (real <= soArmazenamento + TAXA_COBRANCA) {
    throw new Error(`R$ ${(real / 100).toFixed(2)} não cobre armazenamento + taxa + IOF/câmbio`);
  }
  const esperado = soArmazenamento * (1 + IOF) * (1 + SPREAD_CARTAO) + TAXA_COBRANCA;
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
  if (meio <= TAXA_COBRANCA) throw new Error("a taxa da cobrança sumiu do cálculo");
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
  const impossivel = montar({ segmento: "foto", espacoGb: 100 });
  const n = clientesParaEquilibrio(
    { segmento: "foto", espacoGb: 100 },
    { precoCentavos: 1 }, // um centavo: jamais cobre o custo variável
  );
  if (n !== null) throw new Error(`esperava null, veio ${n} (preço de R$ 0,01)`);
  return `${impossivel.nome} a R$ 0,01 não fecha, e diz isso`;
});

console.log(falhou ? "\n✗ a conta de custos fixos tem problema\n" : "\n✓ custos fixos ok\n");
process.exit(falhou ? 1 : 0);
