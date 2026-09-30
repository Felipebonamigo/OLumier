#!/usr/bin/env node
/**
 * Testa a CONFERÊNCIA DE PAGAMENTOS PERDIDOS — a rede embaixo do webhook.
 * Uso: node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-pagamentos-perdidos.mjs
 *
 * 30/09/2026: a Bia Zac pagou, o aviso do Asaas não foi contado, e o admin
 * seguiu com "0 pagantes". Ver `src/lib/pagamentos-perdidos.ts`.
 *
 * Prende:
 *   1. Pagamento no Asaas que nós não contamos é ACHADO e, contado, deixa a
 *      conta como o webhook deixaria (ativa, período pago, e-mail).
 *   2. Cobrança já contada NÃO é achada de novo — rodar de hora em hora é seguro.
 *   3. Sem cobrança paga, nada. Cortesia fica de fora.
 *   4. A escrita é a mesma do webhook (as duas cópias andam juntas).
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

const enviados = [];
const correio = http.createServer((req, res) => {
  let c = "";
  req.on("data", (p) => (c += p));
  req.on("end", () => {
    enviados.push(JSON.parse(c || "{}"));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
});
await new Promise((ok) => correio.listen(0, "127.0.0.1", ok));
process.env.EMAIL_API = `http://127.0.0.1:${correio.address().port}/emails`;
process.env.RESEND_API_KEY = "re_so_da_suite_local";
process.env.EMAIL_REMETENTE = "avisos@teste.local";
const ADMINS_ANTES = process.env.ADMINS;
process.env.ADMINS = "felipe@teste.local";

/* O Asaas de mentira: cobranças por assinatura, e o mínimo para o combo. */
const cobrancas = new Map(); // assinaturaId -> [{ id, status, value, confirmedDate }]
process.env.ASAAS_API_KEY = "chave-de-mentira";
delete process.env.ASAAS_AMBIENTE;
const asaas = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const r = (s, d) => {
    res.writeHead(s, { "Content-Type": "application/json" });
    res.end(JSON.stringify(d));
  };
  let m = /^\/subscriptions\/([^/]+)\/payments$/.exec(url.pathname);
  if (m) {
    const filtro = url.searchParams.get("status");
    if (cobrancas.get(m[1]) === "QUEBRA") return r(401, { errors: [{ description: "A chave de API fornecida é inválida" }] });
    return r(200, { data: (cobrancas.get(m[1]) ?? []).filter((c) => !filtro || c.status === filtro) });
  }
  m = /^\/subscriptions\/([^/]+)$/.exec(url.pathname);
  if (m) return r(200, { id: m[1], status: "ACTIVE", value: 79.99, description: "Galeria Átomo — Foto · 500 GB" });
  if (url.pathname === "/customers" || url.pathname === "/subscriptions") return r(200, { data: [] });
  return r(404, {});
});
await new Promise((ok) => asaas.listen(0, "127.0.0.1", ok));
process.env.ASAAS_API = `http://127.0.0.1:${asaas.address().port}`;

const P = await import("../src/lib/pagamentos-perdidos.ts");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
const etapa = async (nome, fn) => {
  enviados.length = 0;
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

try {
  const t = await estudioDaRodada(db, { nome: "Bia Zac Fotografia" });
  const assinatura = `sub_${t.id.slice(0, 8)}`;
  const doTeste = (r) => r.perdidos.filter((p) => p.tenantId === t.id);
  const preparar = async ({ status = "trial", pagoAte = null, cobranca = null } = {}) => {
    await db.query(
      `update tenants set status = $1, pago_ate = $2, plano_id = 'g:foto:500', ciclo_cobranca = 'mensal',
              asaas_assinatura_id = $3, cpf_cnpj = null, trial_ate = now() + interval '5 days' where id = $4`,
      [status, pagoAte, assinatura, t.id],
    );
    cobrancas.set(assinatura, cobranca ? [cobranca] : [{ id: "pay_aberta", status: "PENDING", value: 79.99 }]);
  };
  const hoje = new Date().toISOString().slice(0, 10);

  console.log("\nA conferência:\n");

  await etapa("pagamento no Asaas que não contamos é achado", async () => {
    await preparar({ cobranca: { id: "pay_bia", status: "RECEIVED", value: 79.99, confirmedDate: hoje } });
    const achados = doTeste(await P.procurarPagamentosPerdidos());
    igual(achados.map((p) => [p.cobrancaId, p.valorCentavos, p.pagoAteAntes]), [["pay_bia", 7999, null]], "achados");
  });

  await etapa("contado, a conta fica como o webhook deixaria, e o e-mail sai", async () => {
    const [p] = doTeste(await P.procurarPagamentosPerdidos());
    await P.registrarPagamentoPerdido(p);
    const l = (await db.query("select status, trial_ate, pago_ate, plano_do_periodo from tenants where id = $1", [t.id])).rows[0];
    igual([l.status, l.trial_ate, l.plano_do_periodo], ["ativo", null, "g:foto:500"], "conta");
    if (!l.pago_ate || new Date(l.pago_ate) <= new Date()) throw new Error(`pago_ate: ${l.pago_ate}`);
    if (enviados.length !== 1) throw new Error(`e-mails: ${enviados.length}`);
    if (!enviados[0].subject.includes("pagou pela primeira vez")) throw new Error(`assunto: ${enviados[0].subject}`);
    return enviados[0].subject.replace(/ /g, " ");
  });

  await etapa("a mesma cobrança não é achada de novo — rodar de hora em hora é seguro", async () => {
    igual(doTeste(await P.procurarPagamentosPerdidos()).length, 0, "achados na segunda passada");
  });

  await etapa("sem cobrança paga, nada", async () => {
    await preparar({});
    igual(doTeste(await P.procurarPagamentosPerdidos()).length, 0, "achados");
  });

  await etapa("renovação perdida de quem já é ativo também é achada", async () => {
    const mesPassado = new Date(Date.now() - 20 * 86400000);
    await preparar({ status: "ativo", pagoAte: mesPassado, cobranca: { id: "pay_renova", status: "CONFIRMED", value: 79.99, confirmedDate: hoje } });
    igual(doTeste(await P.procurarPagamentosPerdidos()).map((p) => p.cobrancaId), ["pay_renova"], "achados");
  });

  await etapa("cortesia fica de fora", async () => {
    await preparar({ status: "cortesia", cobranca: { id: "pay_x", status: "RECEIVED", value: 79.99, confirmedDate: hoje } });
    igual(doTeste(await P.procurarPagamentosPerdidos()).length, 0, "achados");
  });

  await etapa("chave escapada como no servidor (\\$aact…) ainda fala com o Asaas", async () => {
    const guardada = process.env.ASAAS_API_KEY;
    process.env.ASAAS_API_KEY = "\\$aact_chave_de_mentira";
    try {
      const { chaveDoAsaas } = await import("../src/lib/asaas.ts");
      igual(chaveDoAsaas(), "$aact_chave_de_mentira", "chave sem a barra");
    } finally {
      process.env.ASAAS_API_KEY = guardada;
    }
  });

  await etapa("quem não pôde ser conferido volta como falha, e não some", async () => {
    await preparar({ cobranca: { id: "pay_bia", status: "RECEIVED", value: 79.99, confirmedDate: hoje } });
    const antes = cobrancas.get(assinatura);
    cobrancas.set(assinatura, "QUEBRA");
    try {
      const r = await P.procurarPagamentosPerdidos();
      if (!r.falhas.some((f) => f.tenantId === t.id)) throw new Error("a falha sumiu");
    } finally {
      cobrancas.set(assinatura, antes);
    }
  });

  await etapa("a escrita é a mesma do webhook", () => {
    const fonte = readFileSync(new URL("../src/app/api/asaas/webhook/route.ts", import.meta.url), "utf8");
    const i = fonte.indexOf("set status = 'ativo', trial_ate = null");
    const doWebhook = fonte.slice(fonte.lastIndexOf("`", i) + 1, fonte.indexOf("`", i));
    const limpar = (s) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
    igual(limpar(P.SQL_MARCAR_PAGO), limpar(doWebhook), "SQL");
  });
} finally {
  if (ADMINS_ANTES === undefined) delete process.env.ADMINS;
  else process.env.ADMINS = ADMINS_ANTES;
  await limparRodada(db);
  await db.end();
  correio.close();
  asaas.close();
}

if (falhou) {
  console.error("\n✗ A conferência de pagamentos perdidos tem etapa vermelha.\n");
  process.exit(1);
}
console.log("\n✓ Pagamentos perdidos conferidos.\n");
