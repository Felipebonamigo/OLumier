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
import { estudioDaRodada, galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

// Os testes abaixo publicam galeria, removem senha e apagam midia.
exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

// Estudio proprio desta execucao (ver fixture-de-teste.mjs).
const estudio = await estudioDaRodada(db);
const tenantId = estudio.id;
/* Uma galeria publicada e no ar: a etapa do atraso prova que o boleto do
 * fotografo NAO derruba a entrega do cliente dele, e sem galeria a checagem
 * passaria vazia — que e pior que reprovar. */
await galeriaDaRodada(db);
const statusOriginal = estudio.status;

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

/*
 * Antes isto exigia uma linha em RESERVA_POR_PLANO para cada plano. Não serve
 * mais: desde que o plano virou montagem, a tabela cobre só os seis ids antigos
 * e a reserva das montagens é calculada do custo. A checagem passou a ser a que
 * realmente importa — e é mais dura que a anterior, porque compara a reserva
 * com o custo de verdade em vez de só conferir se alguém preencheu a tabela.
 */
await etapa("a reserva de custo cobre o custo real de cada plano", async () => {
  const planos = await import("../src/config/planos.ts");
  let sobObra = 0;
  for (const p of planos.planos) {
    /*
     * `espacoGb`, e não `galeriaGb`/`cofreGb`.
     *
     * A forma antiga é de quando o cofre era peça do plano, e ficou aqui depois
     * da unificação de 25/08/2026. `custoArmazenamentoTetoCentavos` lê `espacoGb`, então o
     * custo virava NaN — e `reserva < NaN` é sempre falso. Esta etapa, que
     * existe justamente para provar que a reserva cobre o custo, não tinha como
     * ficar vermelha. Teste que não pode falhar é pior que teste nenhum: ocupa
     * a vaga de um que poderia. Hoje `custoArmazenamentoCentavos` recusa montagem sem
     * `espacoGb` em vez de devolver NaN, para o erro não voltar calado.
     */
    const custo = planos.custoArmazenamentoTetoCentavos({
      segmento: p.segmento,
      espacoGb: p.quotaGb,
    });
    const lucro = socios.lucroCentavos(p.id, p.precoCentavos);
    const reserva = p.precoCentavos - lucro;

    if (lucro > 0) {
      // Distribuiu lucro: a reserva que ficou TEM de cobrir o custo real.
      if (reserva < custo) {
        throw new Error(
          `reserva do ${p.id} (R$${(reserva / 100).toFixed(0)}) não cobre o custo (R$${(custo / 100).toFixed(0)})`,
        );
      }
    } else {
      // Lucro zero = reteve o preço inteiro — o máximo que dá para segurar.
      // Acontece enquanto a rota atual (tudo R2 + espelho) custar mais que a
      // grade, que foi feita para a rota da obra. Ver "dinheiro" no
      // testar-planos, que prende a mesma regra montagem por montagem.
      sobObra++;
    }
  }
  return `${planos.planos.length} planos conferidos${sobObra ? `, ${sobObra} sob obra retendo 100%` : ""}`;
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
// A bancada desta execucao sai inteira (ver fixture-de-teste.mjs).
await limparRodada(db);
await db.end();

if (falhou) {
  console.error("\n✗ a cobrança tem problema");
  process.exit(1);
}
console.log("\n✓ cobrança íntegra — e o Atomatiza continua isolado");
