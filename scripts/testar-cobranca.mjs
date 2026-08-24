#!/usr/bin/env node
/**
 * Testa a cobrança. Uso:
 *   node --env-file=.env.local scripts/testar-cobranca.mjs
 *
 * O risco mais sério aqui não é a cobrança falhar — é ela funcionar demais: a
 * conta do Asaas é COMPARTILHADA com o Atomatiza, que está em produção com
 * clientes reais. Um webhook mal filtrado mexeria nas contas de lá.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";

// Os testes abaixo publicam galeria, removem senha e apagam midia.
exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const { rows } = await db.query("select id, status from tenants order by criado_em limit 1");
const tenantId = rows[0].id;
const statusOriginal = rows[0].status;

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};

const enviarEvento = (corpo, token) =>
  fetch(`${BASE}/api/asaas/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "asaas-access-token": token } : {}),
    },
    body: JSON.stringify(corpo),
  });

const statusDoTenant = async () => {
  const { rows: r } = await db.query("select status from tenants where id = $1", [tenantId]);
  return r[0].status;
};

// Sem token a rota inteira responde 503 de propósito (porta fechada é o padrão
// seguro), então aqui ele é obrigatório em vez de opcional.
const token = process.env.ASAAS_WEBHOOK_TOKEN;
if (!token) {
  console.error(
    "✗ falta ASAAS_WEBHOOK_TOKEN no .env.local — gere com:\n" +
      '  node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))"',
  );
  process.exit(1);
}

console.log("Isolamento do Atomatiza (a conta do Asaas é a mesma):\n");

await etapa("evento SEM referência nossa é ignorado", async () => {
  await db.query("update tenants set status = 'trial' where id = $1", [tenantId]);
  const r = await enviarEvento(
    { event: "PAYMENT_CONFIRMED", payment: { externalReference: "atomatiza:123", value: 99 } },
    token,
  );
  const d = await r.json();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (!d.ignorado) throw new Error("não marcou como ignorado");
  if ((await statusDoTenant()) !== "trial") throw new Error("MEXEU no estúdio!");
  return "HTTP 200 e nada alterado";
});

await etapa("evento sem referência nenhuma é ignorado", async () => {
  const r = await enviarEvento({ event: "PAYMENT_CONFIRMED", payment: { value: 50 } }, token);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if ((await statusDoTenant()) !== "trial") throw new Error("mexeu no estúdio");
  return "HTTP 200";
});

await etapa("responde 200 mesmo ao ignorar (não trava a fila do Asaas)", async () => {
  const r = await enviarEvento({ event: "COISA_ESTRANHA", payment: {} }, token);
  if (r.status !== 200) {
    throw new Error(`veio ${r.status} — erro faria o Asaas suspender a fila da conta inteira`);
  }
  return "HTTP 200";
});

console.log("\nCiclo de cobrança:\n");

await etapa("pagamento confirmado ativa o estúdio", async () => {
  const r = await enviarEvento(
    { event: "PAYMENT_CONFIRMED", payment: { externalReference: `olumier:${tenantId}`, value: 129 } },
    token,
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const s = await statusDoTenant();
  if (s !== "ativo") throw new Error(`status ficou "${s}"`);
  return "trial → ativo";
});

await etapa("atraso marca inadimplente SEM derrubar as galerias", async () => {
  const r = await enviarEvento(
    { event: "PAYMENT_OVERDUE", payment: { externalReference: `olumier:${tenantId}` } },
    token,
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if ((await statusDoTenant()) !== "inadimplente") throw new Error("não marcou inadimplente");

  // O cliente final do fotógrafo não tem culpa de um boleto atrasado.
  const { rows: g } = await db.query(
    "select count(*)::int n from galerias where tenant_id = $1 and publicada and estado = 'online'",
    [tenantId],
  );
  if (g[0].n === 0) throw new Error("as galerias saíram do ar por causa do atraso");
  return `${g[0].n} galeria(s) seguem no ar`;
});

await etapa("cancelamento marca cancelado", async () => {
  const r = await enviarEvento(
    { event: "SUBSCRIPTION_DELETED", subscription: { externalReference: `olumier:${tenantId}` } },
    token,
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if ((await statusDoTenant()) !== "cancelado") throw new Error("não cancelou");
  return "cancelado";
});

await etapa("referência nossa com estúdio inexistente não quebra", async () => {
  const r = await enviarEvento(
    {
      event: "PAYMENT_CONFIRMED",
      payment: { externalReference: "olumier:00000000-0000-0000-0000-000000000000" },
    },
    token,
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return "HTTP 200";
});

// Antes isto ficava dentro de um `if (token)` e o teste era PULADO em silêncio
// quando a variável estava vazia — que era justamente o caso em que a rota
// aceitava qualquer POST anônimo. O teste passava verde por cima do furo.
await etapa("token errado é recusado", async () => {
  const r = await enviarEvento(
    { event: "PAYMENT_CONFIRMED", payment: { externalReference: `olumier:${tenantId}` } },
    "token-inventado",
  );
  if (r.status !== 401) throw new Error(`esperava 401, veio ${r.status}`);
  return "HTTP 401";
});

await etapa("requisição SEM token nenhum é recusada", async () => {
  const r = await enviarEvento(
    { event: "PAYMENT_CONFIRMED", payment: { externalReference: `olumier:${tenantId}` } },
    undefined,
  );
  if (r.status !== 401) throw new Error(`esperava 401, veio ${r.status}`);
  return "HTTP 401";
});

console.log("\nDivisão do dinheiro:\n");

const socios = await import("../src/config/socios.ts");

await etapa("percentuais somam 100%", async () => {
  const soma = socios.SOCIOS.reduce((s, x) => s + x.percentual, 0);
  if (soma !== 100) throw new Error(`somam ${soma}%`);
  return socios.SOCIOS.map((s) => `${s.nome} ${s.percentual}%`).join(" · ");
});

await etapa("a reserva de custo cobre o custo real de cada plano", async () => {
  const planos = await import("../src/config/planos.ts");
  const linhas = [];
  for (const p of planos.planos) {
    const reserva = socios.RESERVA_POR_PLANO[p.id];
    if (reserva === undefined) throw new Error(`plano ${p.id} sem reserva definida`);
    const lucro = socios.lucroCentavos(p.id, p.precoCentavos);
    if (lucro <= 0) throw new Error(`plano ${p.id} não sobra lucro`);
    if (reserva >= p.precoCentavos) throw new Error(`reserva do ${p.id} maior que o preço`);
    linhas.push(`${p.id}: reserva R$${(reserva / 100).toFixed(0)} lucro R$${(lucro / 100).toFixed(0)}`);
  }
  return `${planos.planos.length} planos conferidos`;
});

await etapa("sócio sem carteira não entra no split (em vez de quebrar a cobrança)", async () => {
  const fatias = socios.montarFatias("foto-200", 12900);
  const configuradas = socios.SOCIOS.filter((s) => process.env[s.variavelCarteira]).length;
  if (fatias.length !== configuradas) {
    throw new Error(`${fatias.length} fatias para ${configuradas} carteiras configuradas`);
  }
  return configuradas === 0
    ? "nenhuma carteira ainda — tudo fica na conta principal"
    : `${configuradas} carteira(s) no split`;
});

await db.query("update tenants set status = $1 where id = $2", [statusOriginal, tenantId]);
await db.end();

if (falhou) {
  console.error("\n✗ a cobrança tem problema");
  process.exit(1);
}
console.log("\n✓ cobrança íntegra — e o Atomatiza continua isolado");
