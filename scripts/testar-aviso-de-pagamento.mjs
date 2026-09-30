#!/usr/bin/env node
/**
 * Testa o AVISO DE PAGAMENTO — o e-mail "Fulano pagou" para a lista ADMINS.
 * Uso: node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-aviso-de-pagamento.mjs
 *
 * ── O QUE FOI PEDIDO (30/09/2026) ─────────────────────────────────────────
 *
 * Felipe, depois do pagamento da Bia Zac: "eu também não recebi nenhum e-mail
 * (igual do Atomatiza) que foi pago, temos que garantir o desconto por usar as
 * duas plataformas". Ver `src/lib/aviso-de-pagamento.ts`.
 *
 * ── O QUE ESTE ARQUIVO PRENDE ─────────────────────────────────────────────
 *
 *   1. O E-MAIL SAI para cada administrador, e não sai sem lista.
 *   2. ELE DIZ O COMBO: com o Atomatiza em dia, "Sim" e quanto a Galeria cede;
 *      sem ele, "Não" e o motivo certo (sem assinatura, nunca paga, vencida).
 *   3. ELE AVISA VALOR ERRADO: assinatura cobrando diferente do que deveria.
 *   4. O LUGAR NO WEBHOOK: depois da guarda de cobrança repetida (senão o mesmo
 *      pagamento viraria dois e-mails) e depois do combo (senão mostraria o
 *      valor de antes do acerto).
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

/* ── O correio de mentira ── antes de importar lib/email.ts, que lê EMAIL_API. */
const enviados = [];
const correio = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (p) => (corpo += p));
  req.on("end", () => {
    enviados.push(JSON.parse(corpo || "{}"));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "email_1" }));
  });
});
await new Promise((ok) => correio.listen(0, "127.0.0.1", ok));
process.env.EMAIL_API = `http://127.0.0.1:${correio.address().port}/emails`;
process.env.RESEND_API_KEY = "re_so_da_suite_local";
process.env.EMAIL_REMETENTE = "avisos@teste.local";

/* ── O Asaas de mentira ── o mesmo recorte do testar-combo. */
process.env.ASAAS_API_KEY = "chave-de-mentira";
delete process.env.ASAAS_AMBIENTE;
const estado = { clientes: [], assinaturas: [], vencidas: new Set(), pagas: new Set() };
const asaas = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const responder = (status, dados) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(dados));
  };
  const p = url.pathname;
  if (p === "/customers") {
    const doc = url.searchParams.get("cpfCnpj");
    return responder(200, { data: estado.clientes.filter((c) => c.cpfCnpj === doc) });
  }
  if (p === "/subscriptions") {
    const cliente = url.searchParams.get("customer");
    return responder(200, { data: estado.assinaturas.filter((a) => a.customer === cliente) });
  }
  let m = /^\/subscriptions\/([^/]+)\/payments$/.exec(p);
  if (m) {
    const cobrancas = [
      ...(estado.pagas.has(m[1]) ? [{ id: "pay_paga", status: "RECEIVED" }] : [{ id: "pay_aberta", status: "PENDING" }]),
      ...(estado.vencidas.has(m[1]) ? [{ id: "pay_vencida", status: "OVERDUE" }] : []),
    ];
    const filtro = url.searchParams.get("status");
    return responder(200, { data: cobrancas.filter((c) => !filtro || c.status === filtro) });
  }
  m = /^\/subscriptions\/([^/]+)$/.exec(p);
  if (m) {
    const a = estado.assinaturas.find((x) => x.id === m[1]);
    return a ? responder(200, a) : responder(404, {});
  }
  return responder(404, {});
});
await new Promise((ok) => asaas.listen(0, "127.0.0.1", ok));
process.env.ASAAS_API = `http://127.0.0.1:${asaas.address().port}`;

const { avisarPagamento } = await import("../src/lib/aviso-de-pagamento.ts");
const { diagnosticarCombo } = await import("../src/lib/combo.ts");
const { planoPorId } = await import("../src/config/planos.ts");
const C = await import("../src/config/combo.ts");

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
/* `toLocaleString` separa "R$" do número com espaço que não quebra (U+00A0). */
const contem = (texto, trecho, o) => {
  if (!String(texto).replace(/\u00a0/g, " ").includes(trecho)) throw new Error(`${o}: esperava "${trecho}" em «${texto}»`);
};

const DOC = "52998224725";
const PLANO = "g:foto:500";
const ADMINS_ANTES = process.env.ADMINS;

try {
  const t = await estudioDaRodada(db, { nome: "Bia Zac Fotografia" });
  const plano = planoPorId(PLANO);
  const cheio = plano.precoCentavos;

  const preparar = async ({ atomatiza = null, paga = true, vencida = false, valorNosso } = {}) => {
    estado.clientes = [
      { id: "cus_nosso", cpfCnpj: DOC },
      { id: "cus_atz", cpfCnpj: DOC },
    ];
    estado.assinaturas = [];
    estado.pagas = new Set();
    estado.vencidas = new Set();
    if (atomatiza) {
      estado.assinaturas.push({
        id: "sub_atz",
        customer: "cus_atz",
        status: "ACTIVE",
        value: 89.9,
        cycle: "MONTHLY",
        description: `Atomatiza — plano ${atomatiza}`,
        externalReference: "atz:sub:studio-1",
      });
      if (paga) estado.pagas.add("sub_atz");
      if (vencida) estado.vencidas.add("sub_atz");
    }
    estado.assinaturas.push({
      id: "sub_nossa",
      customer: "cus_nosso",
      status: "ACTIVE",
      value: (valorNosso ?? cheio) / 100,
      cycle: "MONTHLY",
      description: "Galeria Átomo — Foto · 500 GB",
      externalReference: `olumier:${t.id}`,
    });
    await db.query(
      `update tenants set plano_id = $1, ciclo_cobranca = 'mensal', cpf_cnpj = $2,
              asaas_assinatura_id = 'sub_nossa', asaas_cliente_id = 'cus_nosso' where id = $3`,
      [PLANO, DOC, t.id],
    );
  };

  console.log("\nO e-mail:\n");

  await etapa("sai para cada administrador, com o estúdio e o valor pago no assunto", async () => {
    process.env.ADMINS = "felipe@teste.local, juan@teste.local";
    await preparar({ atomatiza: "equipe", valorNosso: C.precoDoCicloComComboCentavos(plano, "mensal", "equipe") });
    await avisarPagamento(t.id, { valor: 65.87, evento: "PAYMENT_RECEIVED", primeiro: true });
    if (enviados.length !== 2) throw new Error(`esperava 2 e-mails, saíram ${enviados.length}`);
    const [a] = enviados;
    if (!a.to.includes("felipe@teste.local")) throw new Error(`destinatário: ${a.to}`);
    contem(a.subject, "Bia Zac Fotografia pagou pela primeira vez", "assunto");
    contem(a.subject, "R$ 65,87", "assunto");
    return a.subject;
  });

  await etapa("sem lista ADMINS, não sai e-mail nenhum", async () => {
    process.env.ADMINS = "";
    await preparar({ atomatiza: "equipe" });
    await avisarPagamento(t.id, { valor: 79.99, evento: "PAYMENT_RECEIVED", primeiro: false });
    if (enviados.length !== 0) throw new Error(`saíram ${enviados.length}`);
  });

  console.log("\nO combo no e-mail:\n");
  process.env.ADMINS = "felipe@teste.local";

  await etapa("Atomatiza em dia: diz Sim, a faixa e quanto a Galeria cede", async () => {
    await preparar({ atomatiza: "equipe", valorNosso: C.precoDoCicloComComboCentavos(plano, "mensal", "equipe") });
    await avisarPagamento(t.id, { valor: 65.87, evento: "PAYMENT_RECEIVED", primeiro: false });
    const txt = enviados[0].text;
    contem(txt, "Combo com o Atomatiza: Sim — Atomatiza Equipe", "texto");
    contem(txt, "o valor certo", "texto");
    contem(enviados[0].subject, "· combo", "assunto");
    contem(enviados[0].subject, "renovou", "assunto");
  });

  await etapa("sem Atomatiza: diz Não e por quê", async () => {
    await preparar({});
    await avisarPagamento(t.id, { valor: 79.99, evento: "PAYMENT_RECEIVED", primeiro: false });
    contem(enviados[0].text, "Não — nenhuma assinatura do Atomatiza com este CPF/CNPJ", "texto");
  });

  await etapa("Atomatiza ainda sem nenhum pagamento: o motivo diz isso", async () => {
    await preparar({ atomatiza: "solo", paga: false });
    const d = await diagnosticarCombo(t.id);
    contem(d.motivo, "nenhuma cobrança paga ainda", "motivo");
  });

  await etapa("Atomatiza com cobrança vencida: o motivo diz isso", async () => {
    await preparar({ atomatiza: "solo", vencida: true });
    const d = await diagnosticarCombo(t.id);
    contem(d.motivo, "cobrança vencida", "motivo");
  });

  await etapa("assinatura cobrando diferente do certo vira ATENÇÃO no e-mail", async () => {
    await preparar({ atomatiza: "equipe", valorNosso: cheio }); // cheio, mas deveria ter o combo
    await avisarPagamento(t.id, { valor: cheio / 100, evento: "PAYMENT_RECEIVED", primeiro: false });
    contem(enviados[0].text, "ATENÇÃO: a assinatura cobra", "texto");
  });

  await etapa("o nome do estúdio é escapado no HTML", async () => {
    await db.query("update tenants set nome_estudio = $1 where id = $2", ["Bia <b>Zac</b>", t.id]);
    await preparar({});
    await avisarPagamento(t.id, { valor: 79.99, evento: "PAYMENT_RECEIVED", primeiro: false });
    if (enviados[0].html.includes("<b>Zac</b>")) throw new Error("HTML do nome passou cru");
    contem(enviados[0].html, "&lt;b&gt;Zac", "html");
  });

  console.log("\nO lugar no webhook:\n");

  await etapa("o aviso vem depois da guarda de cobrança repetida e depois do combo", () => {
    const fonte = readFileSync(new URL("../src/app/api/asaas/webhook/route.ts", import.meta.url), "utf8");
    const guarda = fonte.indexOf('ignorado: "cobrança já contada"');
    const combo = fonte.indexOf("await recalcularCombo(tenantId");
    const aviso = fonte.indexOf("await avisarPagamento(tenantId");
    if (guarda < 0 || combo < 0 || aviso < 0) throw new Error("não achei a guarda, o combo ou o aviso");
    if (!(guarda < combo && combo < aviso)) throw new Error("ordem errada: guarda → combo → aviso");
    if (!/avisarPagamento\([^]*?\)\.catch\(/.test(fonte.slice(aviso, aviso + 300))) {
      throw new Error("aviso sem .catch — um e-mail que falha viraria rejeição solta");
    }
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
  console.error("\n✗ O aviso de pagamento tem etapa vermelha.\n");
  process.exit(1);
}
console.log("\n✓ Aviso de pagamento conferido.\n");
