#!/usr/bin/env node
/**
 * Quantos clientes pagam a operação.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/ponto-de-equilibrio.mjs
 *
 * A margem de um plano diz se aquele plano se paga. Esta conta diz outra coisa,
 * e é a que decide se o NEGÓCIO se paga: com o custo fixo do mês (DAS-MEI, VPS,
 * domínio) e a margem por cliente, quantos clientes fecham a conta.
 *
 * Não é teste — por isso o nome não começa com `testar-`, e a suíte não o roda.
 * As regras que ele imprime estão presas em `scripts/testar-custos-fixos.mjs`.
 */
import {
  CUSTOS_FIXOS,
  IOF,
  SPREAD_CARTAO,
  custoFixoMensalCentavos,
  custosPorConfirmar,
  lucroTotalPorClienteCentavos,
  tabelaDeEquilibrio,
} from "../src/config/custos-fixos.ts";
import { ESPACOS, formatarGb, formatarReais } from "../src/config/planos.ts";
import { SOCIOS } from "../src/config/socios.ts";

/*
 * Quantos clientes a tabela principal assume. É o número que dilui o custo
 * fixo, e sem ele "custo total" não tem valor único: a fatia de um cliente só é
 * R$ 129,33, a de vinte é R$ 6,47.
 *
 * Dez é o padrão porque é uma carteira pequena e plausível — não porque exista
 * previsão nenhuma. `--clientes=N` troca.
 */
const arg = process.argv.find((a) => a.startsWith("--clientes="));
const CLIENTES = arg ? Number(arg.split("=")[1]) : 10;
if (!Number.isInteger(CLIENTES) || CLIENTES < 1) {
  console.error(`--clientes precisa ser inteiro >= 1, veio "${arg?.split("=")[1]}"`);
  process.exit(1);
}

const linha = (n = 74) => "─".repeat(n);
const rs = (c) => formatarReais(c).padStart(11);

console.log(`\n${linha()}`);
console.log("CUSTO FIXO DO MÊS — o que se paga sem nenhum cliente");
console.log(linha());

for (const c of CUSTOS_FIXOS) {
  const marca = c.confirmado ? " " : "~";
  console.log(`${marca} ${c.nome.padEnd(28)} ${rs(c.centavosPorMes)}`);
}
console.log(`  ${"TOTAL".padEnd(28)} ${rs(custoFixoMensalCentavos())}`);

const chutes = custosPorConfirmar();
if (chutes.length > 0) {
  console.log(`\n  ~ = estimativa, ainda não conferida (${chutes.length} de ${CUSTOS_FIXOS.length}):`);
  for (const c of chutes) console.log(`      ${c.nome}: ${c.nota}`);
}

/*
 * Duas ocupações, e a diferença entre elas é o ponto das tabelas.
 *
 * 100% é o pior caso: o cliente encheu o que contratou. É por ele que a reserva
 * de custo é dimensionada, porque reserva é proteção. Mas decidir preço e meta
 * de vendas pelo pior caso subestima o negócio pela metade — a ocupação real de
 * um estúdio fica entre 30% e 60%, e nenhum contrata 5 TB para usar 5 TB no
 * primeiro mês.
 */
for (const [rotulo, ocupacao] of [
  ["ESPAÇO 100% CHEIO — o pior caso", 1],
  ["ESPAÇO PELA METADE — mais perto do real", 0.5],
]) {
  console.log(`\n${linha(82)}`);
  console.log(`CUSTO TOTAL × PREÇO × LUCRO — com ${CLIENTES} cliente(s) pagando`);
  console.log(`${rotulo}   ·   IOF ${(IOF * 100).toFixed(1)}% + spread ${(SPREAD_CARTAO * 100).toFixed(0)}% inclusos`);
  console.log(linha(82));
  console.log(
    "faixa".padEnd(8) +
      "preço".padStart(11) +
      "armazém+".padStart(11) +
      "fixo/cli".padStart(11) +
      "CUSTO TOT".padStart(11) +
      "LUCRO".padStart(11) +
      "margem".padStart(9) +
      "equil.".padStart(8),
  );

  for (const l of tabelaDeEquilibrio(CLIENTES, ocupacao)) {
    console.log(
      formatarGb(l.gb).padEnd(8) +
        rs(l.precoCentavos) +
        rs(l.custoVariavelCentavos) +
        rs(l.fatiaFixaCentavos) +
        rs(l.custoTotalCentavos) +
        rs(l.lucroCentavos) +
        `${l.margemPct.toFixed(0)}%`.padStart(9) +
        (l.clientes === null ? "—" : String(l.clientes)).padStart(8),
    );
  }
  console.log(
    "\n  armazém+ = B2 e R2 com IOF, câmbio e a taxa do Asaas · fixo/cli = " +
      `${formatarReais(custoFixoMensalCentavos())} ÷ ${CLIENTES}`,
  );
  console.log(`  equil. = quantos clientes DAQUELA faixa zerariam a conta sozinhos`);
}

/*
 * A tabela acima congela um número de clientes; esta mostra o movimento.
 *
 * É a que responde "quanto muda se eu vender mais": o custo fixo não some, ele
 * dilui — e o ganho de 1 para 5 clientes é muito maior que o de 10 para 20.
 * Prejuízo aparece com sinal, sem travar em zero: "R$ 0,00" numa tabela de
 * decisão lê-se como empate, e um cliente só de 100 GB não empata.
 */
console.log(`\n${linha(82)}`);
console.log("LUCRO POR CLIENTE conforme a carteira cresce   (espaço 100% cheio)");
console.log(linha(82));
const CARTEIRAS = [1, 3, 5, 10, 20, 50];
console.log("faixa".padEnd(8) + CARTEIRAS.map((n) => `${n} cli`.padStart(12)).join(""));
for (const e of ESPACOS) {
  const m = { segmento: "foto", espacoGb: e.gb };
  console.log(
    formatarGb(e.gb).padEnd(8) +
      CARTEIRAS.map((n) =>
        formatarReais(Math.round(lucroTotalPorClienteCentavos(m, { clientes: n }))).padStart(12),
      ).join(""),
  );
}

/*
 * A parte que a tabela acima esconde, e que é a mais importante.
 *
 * O split manda o LUCRO embora todo mês. A reserva que fica na conta cobre o
 * armazenamento — e só ele. DAS-MEI, VPS e domínio não estão em reserva
 * nenhuma: saem do bolso de quem paga, depois de o dinheiro já ter sido
 * dividido. Com três sócios, cada real de custo fixo custa dois reais de
 * faturamento para quem banca sozinho.
 */
const fixo = custoFixoMensalCentavos();
const felipe = SOCIOS.find((s) => s.id === "felipe");
console.log(`\n${linha()}`);
console.log("O QUE ESTA CONTA NÃO RESOLVE");
console.log(linha());
console.log(`
  O split manda o lucro embora todo mês, e a reserva que fica na conta cobre
  o ARMAZENAMENTO — só ele. Os ${formatarReais(fixo)} acima não estão em reserva
  nenhuma: saem depois de o dinheiro já ter sido dividido.

  Se quem banca é o Felipe (${felipe?.percentual ?? "?"}% do lucro), a conta dele precisa render
  ${formatarReais(Math.ceil((fixo * 100) / (felipe?.percentual ?? 100)))} de lucro TOTAL para sobrar ${formatarReais(fixo)} na mão dele.
  Ou seja: os números da tabela dobram para quem paga a operação sozinho.

  Decisões possíveis, nenhuma tomada:
    · tirar o custo fixo ANTES do split (vira custo da sociedade, não do Felipe);
    · deixar como está e tratar como investimento dele;
    · rever os percentuais — hoje são PROPOSTA, não acordo (ver socios.ts).
`);

console.log(`${linha()}`);
console.log("Fontes: src/config/custos-fixos.ts (custo fixo, IOF, câmbio)");
console.log("        src/config/planos.ts       (preço e armazenamento)");
console.log(`${linha()}\n`);
