#!/usr/bin/env node
/**
 * A DEVOLUÇÃO AO CANCELAR — a regra e o caminho do dinheiro. Uso:
 *   node --env-file=.env.local --conditions=react-server \
 *     --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-devolucao.mjs
 *
 * Decisão do Felipe, 30/09/2026: até 7 dias depois do pagamento, tudo volta;
 * depois, o pago menos os meses começados, cada um pelo preço mensal que o
 * pagamento implica (`config/devolucao.ts`). A regra é pura e vai dia a dia
 * aqui; o resto — de qual cobrança sai o valor, a pendência anotada, a pessoa
 * chamada, o aviso de estorno que fecha — roda contra um Asaas e um correio de
 * mentira deste processo. Nada sai daqui.
 */
import http from "node:http";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, limparRodada, marcaDaRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

/* ── o correio e o Asaas de mentira, antes de importar quem os lê ────────── */
const recebidos = [];
const cobrancas = new Map(); // assinatura → lista de cobranças
const servidor = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/emails") {
      recebidos.push(JSON.parse(corpo));
      res.end('{"id":"teste"}');
      return;
    }
    const m = req.url.match(/^\/asaas\/subscriptions\/([^/]+)\/payments/);
    if (m) {
      res.end(JSON.stringify({ data: cobrancas.get(decodeURIComponent(m[1])) ?? [] }));
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
});
await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
const porta = servidor.address().port;
process.env.EMAIL_API = `http://127.0.0.1:${porta}/emails`;
process.env.RESEND_API_KEY = "re_so_da_suite_local";
process.env.EMAIL_REMETENTE = "avisos@teste.local";
process.env.ALERTA_EMAIL_DESTINO = "alerta@teste.local";
process.env.ASAAS_API = `http://127.0.0.1:${porta}/asaas`;
process.env.ASAAS_API_KEY = "chave-de-mentira";

const { cotarDevolucao, DIAS_DE_ARREPENDIMENTO } = await import("../src/config/devolucao.ts");
const devolucao = await import("../src/lib/devolucao.ts");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
async function etapa(nome, fn) {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const DIA = 24 * 60 * 60 * 1000;
const MARCA = marcaDaRodada();

/* Um anual pago em 10/01/2026 às 00h de Brasília: vai até 10/01/2027. */
const PAGO_EM = new Date("2026-01-10T03:00:00Z");
const FIM_ANUAL = new Date("2027-01-10T03:00:00Z");
const FIM_MENSAL = new Date("2026-02-10T03:00:00Z");
const ANUAL = 100_000; // R$ 1.000 — o mês vale R$ 100
const depois = (dias) => new Date(PAGO_EM.getTime() + dias * DIA);
const anual = (agora) => cotarDevolucao({ pagoCentavos: ANUAL, ciclo: "anual", fimDoPeriodo: FIM_ANUAL, agora });
const mensal = (agora) => cotarDevolucao({ pagoCentavos: 13_900, ciclo: "mensal", fimDoPeriodo: FIM_MENSAL, agora });

try {
  console.log("a regra (pura)");

  await etapa(`até ${DIAS_DE_ARREPENDIMENTO} dias, volta TUDO — no anual e no mensal`, () => {
    for (const d of [0, 1, 6.9, 7]) {
      const a = anual(depois(d));
      igual(a.regra, "arrependimento", `anual, dia ${d}`);
      igual(a.devolverCentavos, ANUAL, `anual, dia ${d}`);
      const m = mensal(depois(d));
      igual(m.devolverCentavos, 13_900, `mensal, dia ${d}`);
    }
  });

  await etapa("anual depois dos 7 dias: o pago menos os meses começados, a um décimo cada", () => {
    const casos = [
      [8, 1, 90_000], //   ainda no 1º mês
      [31, 2, 80_000], //  10/02 já passou: 2º mês começado
      [65, 3, 70_000], //  o exemplo dos Termos: cancelado no 3º mês, voltam R$ 700
      [250, 9, 10_000],
    ];
    for (const [d, meses, devolver] of casos) {
      const c = anual(depois(d));
      igual(c.mesesUsados, meses, `meses no dia ${d}`);
      igual(c.devolverCentavos, devolver, `devolução no dia ${d}`);
      igual(c.regra, "proporcional", `regra no dia ${d}`);
    }
    return "R$ 1.000 no 3º mês → R$ 700";
  });

  await etapa("do 10º mês em diante, nada a devolver — e isso não é erro", () => {
    for (const d of [275, 300, 360]) {
      const c = anual(depois(d));
      igual(c.devolverCentavos, 0, `dia ${d}`);
      igual(c.regra, "nada", `dia ${d}`);
    }
  });

  await etapa("mensal depois dos 7 dias: o mês começado é o mês inteiro", () => {
    for (const d of [8, 20, 30]) igual(mensal(depois(d)).devolverCentavos, 0, `dia ${d}`);
  });

  await etapa("sem período em curso, nada — nem com dinheiro pago", () => {
    igual(cotarDevolucao({ pagoCentavos: ANUAL, ciclo: "anual", fimDoPeriodo: null, agora: depois(3) }).regra, "nada", "sem fim");
    igual(anual(new Date(FIM_ANUAL.getTime() + DIA)).regra, "nada", "período vencido");
    igual(cotarDevolucao({ pagoCentavos: 0, ciclo: "anual", fimDoPeriodo: FIM_ANUAL, agora: depois(3) }).regra, "nada", "zero pago");
  });

  await etapa("o mês sai do PAGAMENTO: combo e preço antigo entram na conta certa", () => {
    /* Um anual com desconto de combo, R$ 900: o mês vale R$ 90, não o de tabela. */
    const c = cotarDevolucao({ pagoCentavos: 90_000, ciclo: "anual", fimDoPeriodo: FIM_ANUAL, agora: depois(65) });
    igual(c.mesCentavos, 9_000, "mês");
    igual(c.devolverCentavos, 63_000, "devolução");
  });

  await etapa("nunca devolve mais do que entrou, em nenhum dia do ano", () => {
    for (let d = 0; d <= 370; d++) {
      const c = anual(depois(d));
      if (c.devolverCentavos < 0 || c.devolverCentavos > ANUAL) throw new Error(`dia ${d}: ${c.devolverCentavos}`);
      if (!Number.isInteger(c.devolverCentavos)) throw new Error(`dia ${d}: centavo quebrado`);
    }
    return "371 dias conferidos";
  });

  console.log("\no caminho do dinheiro (banco, Asaas e correio de mentira)");

  const estudio = await estudioDaRodada(db);
  const tenantId = estudio.id;
  const ASSINATURA = `sub_${MARCA}`;
  cobrancas.set(ASSINATURA, [
    { id: `pay_${MARCA}_velha`, status: "RECEIVED", value: 1000, confirmedDate: "2025-01-10", dueDate: "2025-01-10" },
    { id: `pay_${MARCA}_atual`, status: "CONFIRMED", value: 1000, confirmedDate: "2026-01-10", dueDate: "2026-01-10" },
    { id: `pay_${MARCA}_aberta`, status: "PENDING", value: 1000, dueDate: "2027-01-10" },
  ]);

  await etapa("a cotação sai da cobrança PAGA mais recente, não da aberta nem da velha", async () => {
    const c = await devolucao.cotarCancelamento(
      { asaas_assinatura_id: ASSINATURA, ciclo_cobranca: "anual", pago_ate: FIM_ANUAL },
      depois(65),
    );
    igual(c.cobrancaId, `pay_${MARCA}_atual`, "cobrança");
    igual(c.devolverCentavos, 70_000, "valor");
  });

  await etapa("sem assinatura ou sem pagamento, a cotação é nada — sem erro", async () => {
    const semAssinatura = await devolucao.cotarCancelamento(
      { asaas_assinatura_id: null, ciclo_cobranca: "anual", pago_ate: FIM_ANUAL },
      depois(3),
    );
    igual(semAssinatura.regra, "nada", "sem assinatura");
    const semPagamento = await devolucao.cotarCancelamento(
      { asaas_assinatura_id: "sub_sem_nada", ciclo_cobranca: "anual", pago_ate: FIM_ANUAL },
      depois(3),
    );
    igual(semPagamento.cobrancaId, null, "sem cobrança paga");
  });

  await etapa("anotar chama uma pessoa com a cobrança e o valor", async () => {
    const antes = recebidos.length;
    const nova = await devolucao.anotarDevolucao({
      tenantId,
      estudio: "Estúdio da Suíte",
      cobrancaId: `pay_${MARCA}_atual`,
      centavos: 70_000,
      regra: "proporcional",
    });
    igual(nova, true, "anotada");
    const alerta = recebidos.slice(antes).find((e) => e.to[0] === "alerta@teste.local");
    if (!alerta) throw new Error("ninguém foi chamado");
    if (!alerta.text.includes(`pay_${MARCA}_atual`) || !/700,00/.test(alerta.text)) {
      throw new Error("o alerta não traz a cobrança e o valor");
    }
    const pendentes = (await devolucao.devolucoesPendentes()).filter((d) => d.tenant_id === tenantId);
    igual(pendentes.length, 1, "pendente no caixa");
  });

  await etapa("cancelar duas vezes não devolve em dobro", async () => {
    const antes = recebidos.length;
    const outra = await devolucao.anotarDevolucao({
      tenantId,
      estudio: "Estúdio da Suíte",
      cobrancaId: `pay_${MARCA}_atual`,
      centavos: 70_000,
      regra: "proporcional",
    });
    igual(outra, false, "segunda anotação");
    igual(recebidos.length, antes, "nenhum alerta a mais");
  });

  await etapa("o aviso de estorno do Asaas fecha a pendência — uma vez", async () => {
    igual(await devolucao.marcarDevolucaoFeita(`pay_${MARCA}_atual`), true, "fechou");
    igual(await devolucao.marcarDevolucaoFeita(`pay_${MARCA}_atual`), false, "repetido");
    igual(await devolucao.marcarDevolucaoFeita("pay_de_outro"), false, "cobrança sem devolução");
    const pendentes = (await devolucao.devolucoesPendentes()).filter((d) => d.tenant_id === tenantId);
    igual(pendentes.length, 0, "nada pendente");
  });

  await etapa("o webhook fecha a devolução e o estorno não zera o fim do serviço", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync(new URL("../src/app/api/asaas/webhook/route.ts", import.meta.url), "utf8");
    if (!/PAYMENT_PARTIALLY_REFUNDED[\s\S]{0,120}marcarDevolucaoFeita/.test(fonte)) {
      throw new Error("o webhook não fecha a devolução no estorno parcial");
    }
    if (/pago_ate = null/.test(fonte)) {
      throw new Error("o estorno voltou a zerar pago_ate — a conta encerrada perde de onde contar");
    }
  });
} finally {
  await db.query("delete from devolucoes where cobranca_asaas_id like $1", [`pay_${MARCA}%`]);
  const l = await limparRodada(db);
  await db.end();
  await globalThis._pgPool?.end();
  servidor.close();
  console.log(`\nlimpeza: ${l.estudios} estúdio(s) de teste removido(s)`);
}

if (falhou) {
  console.log("\n✗ falhou");
  process.exit(1);
}
console.log("\n✓ devolução ao cancelar");
