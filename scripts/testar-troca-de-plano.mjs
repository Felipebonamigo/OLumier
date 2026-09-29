#!/usr/bin/env node
/**
 * Testa a TROCA DE PLANO — aumentar cobra só a diferença.
 * Uso: node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-troca-de-plano.mjs
 *
 * ── O QUE FOI PEDIDO (28/09/2026) ─────────────────────────────────────────
 *
 * Felipe: "se o usuário quiser aumentar o pacote da galeria, não cobre
 * novamente, apenas a diferença". Ver `src/config/troca-de-plano.ts`.
 *
 * ── O QUE ESTE ARQUIVO PRENDE ─────────────────────────────────────────────
 *
 *   1. A CONTA: a diferença é proporcional ao que falta do período, contra o
 *      plano já pago nele; descer não cobra; abaixo de R$ 5 fica por nossa
 *      conta; o fim do período é o menor entre `pago_ate` e o próximo
 *      vencimento.
 *   2. O SPLIT da diferença reserva só o espaço A MAIS, e ainda deixa lucro.
 *   3. O FLUXO, contra um Asaas de mentira: cartão salvo primeiro, fatura se
 *      ele recusar, e a assinatura de volta ao valor antigo se nem a fatura
 *      sair — nunca plano maior sem diferença, nem diferença sem plano maior.
 *   4. O WEBHOOK: a diferença paga NÃO renova o período pago.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();
process.env.ASAAS_API_KEY = "chave-de-mentira";
delete process.env.ASAAS_AMBIENTE;
/* Carteiras de mentira: a diferença tem de levar o split, senão os sócios não
   recebem a parte deles do que o estúdio pagou a mais. */
process.env.ASAAS_CARTEIRA_FELIPE = "11111111-1111-1111-1111-111111111111";
process.env.ASAAS_CARTEIRA_CAROL = "22222222-2222-2222-2222-222222222222";
process.env.ASAAS_CARTEIRA_SIRIUS = "33333333-3333-3333-3333-333333333333";

/* ── o Asaas de mentira ─────────────────────────────────────────────────── */
const A = {
  assinatura: null,
  abertas: [], // cobranças da assinatura ainda não pagas: { dueDate, status }
  recusarCartao: false,
  falharFatura: false,
  pedidos: [], // { metodo, caminho, corpo }
  clientesDoDoc: [], // para o combo
  assinaturasDoCliente: {},
};
const srv = createServer((req, res) => {
  let b = "";
  req.on("data", (p) => (b += p));
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    const corpo = b ? JSON.parse(b) : null;
    const ok = (d, s = 200) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(d)); };
    if (req.method !== "GET") A.pedidos.push({ metodo: req.method, caminho: p, corpo });

    if (req.method === "PUT" && p === `/subscriptions/${A.assinatura?.id}`) {
      A.assinatura.value = corpo.value;
      A.assinatura.description = corpo.description;
      return ok(A.assinatura);
    }
    if (req.method === "POST" && p === "/payments") {
      if (corpo.creditCardToken && A.recusarCartao) return ok({ errors: [{ description: "Transação não autorizada." }] }, 400);
      if (!corpo.creditCardToken && A.falharFatura) return ok({ errors: [{ description: "fora do ar" }] }, 503);
      const n = A.pedidos.filter((x) => x.caminho === "/payments").length;
      return ok({ id: `pay_dif_${n}`, status: corpo.creditCardToken ? "CONFIRMED" : "PENDING", value: corpo.value,
        dueDate: corpo.dueDate, invoiceUrl: `https://fatura/${n}`, externalReference: corpo.externalReference });
    }
    if (p === `/subscriptions/${A.assinatura?.id}`) return ok(A.assinatura);
    if (p === `/subscriptions/${A.assinatura?.id}/payments`) {
      return ok({ data: A.abertas.filter((c) => c.status === u.searchParams.get("status")) });
    }
    if (p === "/customers") return ok({ data: A.clientesDoDoc });
    if (p === "/subscriptions") return ok({ data: A.assinaturasDoCliente[u.searchParams.get("customer")] ?? [] });
    let m = /^\/subscriptions\/([^/]+)\/payments$/.exec(p);
    if (m) return ok({ data: u.searchParams.get("status") === "OVERDUE" ? [] : [{ status: "RECEIVED" }] });
    return ok({}, 404);
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
process.env.ASAAS_API = `http://127.0.0.1:${srv.address().port}`;

const T = await import("../src/config/troca-de-plano.ts");
const { trocarPlano, aplicarEventoDaDiferenca } = await import("../src/lib/troca-de-plano.ts");
const { tenantDaReferencia, tipoDaReferencia, referenciaDaDiferenca } = await import("../src/lib/asaas.ts");
const { lucroDaDiferencaCentavos, montarFatiasDaDiferenca } = await import("../src/config/socios.ts");
const { ESPACOS, montar } = await import("../src/config/planos.ts");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
const etapa = async (nome, fn) => {
  A.pedidos = [];
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};
const igual = (a, b, o) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};
const br = (s) => new Date(`${s}-03:00`);

try {
  console.log("\nA conta:\n");

  await etapa("no meio do mês, cobra a diferença proporcional ao que falta", () => {
    const c = T.cotarDiferenca({ precoBaseCentavos: 4999, precoNovoCentavos: 7999, ciclo: "mensal",
      agora: br("2026-10-01T00:00:00"), fimDoPeriodo: br("2026-10-21T00:00:00") });
    igual([c.tipo, c.diferencaCentavos, c.cobrar], ["subida", 2000, true], "tipo / diferença / cobrar");
    return "R$ 30 × 20/30 dias = R$ 20,00";
  });

  await etapa("no anual, a fração é do ano", () => {
    const fim = br("2027-04-01T00:00:00"), agora = br("2026-10-01T00:00:00");
    const c = T.cotarDiferenca({ precoBaseCentavos: 49990, precoNovoCentavos: 119990, ciclo: "anual", agora, fimDoPeriodo: fim });
    const esperado = Math.round(70000 * (fim - agora) / (fim - br("2026-04-01T00:00:00")));
    igual(c.diferencaCentavos, esperado, "diferença");
    if (Math.abs(c.mesesRestantes - 6) > 0.1) throw new Error(`meses restantes ${c.mesesRestantes}`);
    return `R$ ${(esperado / 100).toFixed(2)} por ~6 meses`;
  });

  await etapa("descer não cobra, e sem período pago não há diferença", () => {
    const desc = T.cotarDiferenca({ precoBaseCentavos: 7999, precoNovoCentavos: 4999, ciclo: "mensal",
      agora: br("2026-10-01T00:00:00"), fimDoPeriodo: br("2026-10-21T00:00:00") });
    igual([desc.tipo, desc.diferencaCentavos], ["descida", 0], "descida");
    const trial = T.cotarDiferenca({ precoBaseCentavos: 4999, precoNovoCentavos: 7999, ciclo: "mensal",
      agora: br("2026-10-01T00:00:00"), fimDoPeriodo: null });
    igual([trial.tipo, trial.diferencaCentavos, trial.cobrar], ["subida", 0, false], "sem período pago");
  });

  await etapa("abaixo de R$ 5,00 fica por nossa conta", () => {
    const c = T.cotarDiferenca({ precoBaseCentavos: 4999, precoNovoCentavos: 7999, ciclo: "mensal",
      agora: br("2026-10-20T00:00:00"), fimDoPeriodo: br("2026-10-21T00:00:00") });
    igual([c.diferencaCentavos, c.cobrar], [100, false], "diferença / cobrar");
  });

  await etapa("o fim do período é o menor entre o pago e o próximo vencimento", () => {
    const agora = br("2026-10-01T00:00:00");
    igual(T.fimDoPeriodoParaDiferenca(br("2026-10-23T00:00:00"), br("2026-10-21T00:00:00"), agora)?.toISOString(),
      br("2026-10-21T00:00:00").toISOString(), "pagou atrasado: vale o vencimento");
    igual(T.fimDoPeriodoParaDiferenca(br("2026-09-30T00:00:00"), br("2026-10-21T00:00:00"), agora), null, "período pago já acabou");
    const vencida = T.fimDoPeriodoParaDiferenca(br("2026-10-21T00:00:00"), br("2026-09-28T00:00:00"), agora);
    igual(T.cotarDiferenca({ precoBaseCentavos: 4999, precoNovoCentavos: 7999, ciclo: "mensal", agora, fimDoPeriodo: vencida }).diferencaCentavos,
      0, "fatura vencida em aberto: ela mesma passa ao preço novo");
  });

  await etapa("a referência da diferença é outra, e o estúdio sai dela inteiro", () => {
    const id = "0b1c2d3e-aaaa-bbbb-cccc-123456789abc";
    igual([tenantDaReferencia(`olumier:${id}`), tipoDaReferencia(`olumier:${id}`)], [id, "assinatura"], "mensalidade");
    const r = referenciaDaDiferenca(id, new Date(0));
    igual([r, tenantDaReferencia(r), tipoDaReferencia(r)], [`olumier:${id}:diferenca:0`, id, "diferenca"], "diferença");
  });

  console.log("\nO split da diferença:\n");

  await etapa("reserva só o espaço a mais pelos meses que faltam, e deixa lucro em toda subida", () => {
    let pares = 0;
    for (let i = 0; i + 1 < ESPACOS.length; i++) {
      const de = montar({ segmento: "foto", espacoGb: ESPACOS[i].gb });
      const para = montar({ segmento: "foto", espacoGb: ESPACOS[i + 1].gb });
      for (const [meses, fator] of [[1, 1], [12, 10]]) {
        const dif = (para.precoCentavos - de.precoCentavos) * fator;
        const lucro = lucroDaDiferencaCentavos(de.id, para.id, dif, meses);
        if (lucro <= 0) throw new Error(`${de.nome} → ${para.nome} (${meses} meses): sem lucro`);
        pares++;
      }
    }
    // A reserva é do incremento, não do plano inteiro: o plano de 500 GB inteiro
    // reservaria mais que a diferença de 250 → 500 num mês.
    const l = lucroDaDiferencaCentavos("g:foto:250", "g:foto:500", 3000, 1);
    if (l < 1000) throw new Error(`lucro de 250 → 500 num mês baixo demais: ${l}`);
    return `${pares} subidas`;
  });

  console.log("\nO fluxo, contra um Asaas de mentira:\n");

  const t = await estudioDaRodada(db);
  const AGORA = br("2026-10-01T00:00:00");
  const preparar = async ({ plano = "g:foto:250", ciclo = "mensal", pagoAte = "2026-10-21T00:00:00", doPeriodo = null,
    valor = 49.99, token = "tok_1", proximo = "2026-10-21", abertas = [] } = {}) => {
    A.assinatura = { id: "sub_1", customer: "cus_1", status: "ACTIVE", value: valor, nextDueDate: proximo,
      cycle: ciclo === "anual" ? "YEARLY" : "MONTHLY", description: "Galeria Átomo — Foto · 250 GB",
      creditCard: token ? { creditCardNumber: "4444", creditCardBrand: "VISA", creditCardToken: token } : null };
    A.abertas = abertas;
    A.recusarCartao = false;
    A.falharFatura = false;
    A.clientesDoDoc = [];
    A.assinaturasDoCliente = {};
    await db.query(
      `update tenants set plano_id=$1, ciclo_cobranca=$2, pago_ate=$3, plano_do_periodo=$4, status='ativo',
              asaas_assinatura_id='sub_1', asaas_cliente_id='cus_1', cpf_cnpj='12345678909', combo_atomatiza=null
        where id=$5`,
      [plano, ciclo, pagoAte ? br(pagoAte) : null, doPeriodo, t.id],
    );
  };
  const linha = async () => (await db.query(
    "select plano_id, plano_do_periodo, quota_bytes, status from tenants where id=$1", [t.id])).rows[0];
  const cobrancas = () => A.pedidos.filter((p) => p.caminho === "/payments");
  const puts = () => A.pedidos.filter((p) => p.metodo === "PUT");
  const trocar = (para, extra = {}) => trocarPlano(t.id, para, { ip: "200.1.2.3", agora: AGORA, ...extra });

  await etapa("subir com cartão salvo: a diferença sai no cartão, e o preço novo da próxima fatura", async () => {
    await preparar();
    const r = await trocar("g:foto:500");
    if ("erro" in r) throw new Error(r.erro);
    const [c] = cobrancas();
    igual([c?.corpo.billingType, c?.corpo.value, c?.corpo.creditCardToken, c?.corpo.remoteIp, c?.corpo.dueDate],
      ["CREDIT_CARD", 20, "tok_1", "200.1.2.3", "2026-10-01"], "cobrança");
    if (!c.corpo.externalReference.startsWith(`olumier:${t.id}:diferenca:`)) throw new Error(`referência ${c.corpo.externalReference}`);
    if (!Array.isArray(c.corpo.split) || c.corpo.split.length === 0) {
      throw new Error("a diferença saiu sem split — os sócios não receberiam a parte deles");
    }
    const esperadas = montarFatiasDaDiferenca("g:foto:250", "g:foto:500", 2000, 2 / 3).map((f) => f.percentual);
    igual(c.corpo.split.map((f) => f.percentualValue), esperadas, "split sobre o lucro da diferença");
    igual([puts()[0]?.corpo.value, puts()[0]?.corpo.updatePendingPayments], [79.99, true], "assinatura");
    const l = await linha();
    igual([l.plano_id, l.plano_do_periodo, l.quota_bytes], ["g:foto:500", "g:foto:500", String(500 * 1024 ** 3)], "banco");
    igual(r.diferenca?.noCartao, true, "no cartão");
    return "R$ 20,00 no Visa •••• 4444";
  });

  await etapa("sem cartão salvo: a diferença vira fatura, que vence em 3 dias", async () => {
    await preparar({ token: null });
    const r = await trocar("g:foto:500");
    if ("erro" in r) throw new Error(r.erro);
    const [c] = cobrancas();
    igual([c?.corpo.billingType, c?.corpo.value, c?.corpo.dueDate, c?.corpo.creditCardToken], ["UNDEFINED", 20, "2026-10-04", undefined], "fatura");
    igual([r.diferenca?.noCartao, r.diferenca?.url], [false, "https://fatura/1"], "resultado");
  });

  await etapa("cartão recusado: cai para a fatura, e o plano muda", async () => {
    await preparar();
    A.recusarCartao = true;
    const r = await trocar("g:foto:500");
    if ("erro" in r) throw new Error(r.erro);
    igual(cobrancas().map((c) => c.corpo.billingType), ["CREDIT_CARD", "UNDEFINED"], "tentativas");
    igual((await linha()).plano_id, "g:foto:500", "plano");
  });

  await etapa("sem como cobrar a diferença, nada muda — a assinatura volta ao valor antigo", async () => {
    await preparar();
    A.recusarCartao = true;
    A.falharFatura = true;
    const r = await trocar("g:foto:500");
    if (!("erro" in r)) throw new Error("devia recusar");
    igual(puts().map((p) => p.corpo.value), [79.99, 49.99], "assinatura foi e voltou");
    const l = await linha();
    igual([l.plano_id, l.plano_do_periodo], ["g:foto:250", null], "banco intocado");
  });

  await etapa("no teste grátis (nada pago), não há cobrança à parte", async () => {
    await preparar({ pagoAte: null });
    const r = await trocar("g:foto:500");
    if ("erro" in r) throw new Error(r.erro);
    igual([cobrancas().length, puts()[0]?.corpo.value], [0, 79.99], "cobranças / assinatura");
  });

  await etapa("descer e subir de novo no mesmo período não cobra outra vez", async () => {
    await preparar({ plano: "g:foto:500", doPeriodo: "g:foto:500", valor: 79.99 });
    let r = await trocar("g:foto:250");
    if ("erro" in r) throw new Error(r.erro);
    igual([cobrancas().length, (await linha()).plano_do_periodo], [0, "g:foto:500"], "descida");
    A.pedidos = [];
    r = await trocar("g:foto:500");
    if ("erro" in r) throw new Error(r.erro);
    igual(cobrancas().length, 0, "voltou ao que já tinha pago");
    A.pedidos = [];
    r = await trocar("g:foto:1000");
    if ("erro" in r) throw new Error(r.erro);
    igual(cobrancas()[0]?.corpo.value, 26.67, "de 500 GB para 1 TB, a diferença é só dessa subida");
  });

  await etapa("diferença abaixo de R$ 5,00: o plano muda e nada é cobrado", async () => {
    await preparar();
    const r = await trocarPlano(t.id, "g:foto:500", { ip: "200.1.2.3", agora: br("2026-10-20T00:00:00") });
    if ("erro" in r) throw new Error(r.erro);
    igual([cobrancas().length, (await linha()).plano_id], [0, "g:foto:500"], "cobranças / plano");
    const ev = await db.query(
      "select detalhe from eventos where tenant_id=$1 and acao='plano.trocado' order by criado_em desc limit 1", [t.id]);
    igual(ev.rows[0].detalhe.diferencaAbsorvidaCentavos, 100, "registrado como absorvido");
  });

  await etapa("anual: a diferença é do que falta do ano", async () => {
    await preparar({ ciclo: "anual", pagoAte: "2027-04-01T00:00:00", proximo: "2027-04-01", valor: 499.9 });
    const r = await trocar("g:foto:1000");
    if ("erro" in r) throw new Error(r.erro);
    const esperado = Math.round(70000 * (br("2027-04-01T00:00:00") - AGORA) / (br("2027-04-01T00:00:00") - br("2026-04-01T00:00:00")));
    igual([cobrancas()[0]?.corpo.value, puts()[0]?.corpo.value], [esperado / 100, 1199.9], "diferença / assinatura");
    return `R$ ${(esperado / 100).toFixed(2)}`;
  });

  await etapa("fatura vencida em aberto: ela mesma passa ao preço novo, sem cobrança à parte", async () => {
    await preparar({ abertas: [{ dueDate: "2026-09-21", status: "OVERDUE" }] });
    const r = await trocar("g:foto:500");
    if ("erro" in r) throw new Error(r.erro);
    igual(cobrancas().length, 0, "cobranças");
  });

  await etapa("pagou atrasado: a diferença vai só até o próximo vencimento", async () => {
    await preparar({ pagoAte: "2026-10-23T00:00:00", proximo: "2026-10-21" });
    const r = await trocar("g:foto:500");
    if ("erro" in r) throw new Error(r.erro);
    igual(cobrancas()[0]?.corpo.value, 20, "diferença");
  });

  await etapa("o valor mudou desde a tela: recusa, e nada é tocado", async () => {
    await preparar();
    const r = await trocar("g:foto:500", { cotadoCentavos: 900 });
    if (!("erro" in r) || !r.erro.includes("R$")) throw new Error(`devia recusar com o valor novo: ${JSON.stringify(r)}`);
    igual([A.pedidos.length, (await linha()).plano_id], [0, "g:foto:250"], "nada tocado");
  });

  await etapa("com o combo, a diferença é a dos planos com o combo dos dois lados", async () => {
    await preparar();
    A.clientesDoDoc = [{ id: "cus_atz", cpfCnpj: "12345678909" }];
    A.assinaturasDoCliente = { cus_atz: [{ id: "sub_atz", status: "ACTIVE", externalReference: "atz:sub:s1",
      description: "Atomatiza — plano estúdio" }] };
    const r = await trocar("g:foto:500");
    if ("erro" in r) throw new Error(r.erro);
    // 250 GB + Estúdio = R$ 30,00; 500 GB + Estúdio = R$ 55,00 → R$ 25 × 2/3
    igual([cobrancas()[0]?.corpo.value, puts()[0]?.corpo.value], [16.67, 55], "diferença / assinatura");
  });

  console.log("\nO webhook:\n");

  await etapa("a diferença vencida põe a conta em atraso, e paga a devolve — sem mexer no período", async () => {
    await preparar();
    const antes = (await db.query("select pago_ate from tenants where id=$1", [t.id])).rows[0].pago_ate;
    await aplicarEventoDaDiferenca(t.id, "atrasou", { evento: "PAYMENT_OVERDUE", cobranca: "pay_x", valor: 20 });
    igual((await linha()).status, "inadimplente", "vencida");
    await aplicarEventoDaDiferenca(t.id, "pagou", { evento: "PAYMENT_RECEIVED", cobranca: "pay_x", valor: 20 });
    igual((await linha()).status, "ativo", "paga");
    const depois = (await db.query("select pago_ate from tenants where id=$1", [t.id])).rows[0].pago_ate;
    igual(depois.toISOString(), antes.toISOString(), "pago_ate intocado");
  });

  await etapa("no webhook, a diferença desvia ANTES do 'pagou' que renova o período", () => {
    const fonte = readFileSync(new URL("../src/app/api/asaas/webhook/route.ts", import.meta.url), "utf8");
    const desvio = fonte.indexOf('tipoDaReferencia(referencia!) === "diferenca"');
    const renova = fonte.indexOf("pagoAteDepoisDoAviso(");
    if (desvio < 0 || renova < 0 || desvio > renova) throw new Error("a diferença paga renovaria o período inteiro");
    if (!/plano_do_periodo = plano_id/.test(fonte)) throw new Error("a mensalidade paga não grava o plano do período");
  });
} finally {
  await limparRodada(db);
  await db.end();
  srv.close();
}

if (falhou) {
  console.error("\n✗ A troca de plano tem etapa vermelha.\n");
  process.exit(1);
}
console.log("\n✓ Troca de plano conferida.\n");
