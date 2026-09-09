#!/usr/bin/env node
/**
 * O STATUS `cortesia`. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-cortesia.mjs
 *
 * ── DE ONDE VEIO (09/09/2026) ─────────────────────────────────────────────
 *
 * A Carol bateu no teto de 10 GB do trial no meio de um envio de 1401 fotos. A
 * saída da hora foi marcá-la como `ativo`, e ela funcionou — mas `ativo` quer
 * dizer PAGANTE no resto do sistema: é o que `receitaMensalCentavos` soma. Uma
 * conta de cortesia ali dentro é receita que não existe entrando na conta que o
 * dono usa para decidir.
 *
 * ── A REGRA, EM UMA LINHA ─────────────────────────────────────────────────
 *
 * Cortesia é `ativo` para ACESSO e zero para RECEITA.
 *
 * Três dos cinco lugares já obedecem por construção, e isso é bom sinal — o
 * código já perguntava "é trial?" em vez de "é ativo?" onde a pergunta certa
 * era a primeira:
 *
 *   quotaEfetivaBytes   já devolve a quota cheia para qualquer status ≠ trial
 *   galeriasNoAr        já devolve true para qualquer status ≠ trial
 *   receitaMensalCentavos  já filtra `=== "ativo"`, então ignora cortesia sozinho
 *
 * Os dois que precisam de mão são `situacaoDoTenant` (que lista os status um a
 * um) e o `check` da coluna no banco. Este arquivo prende os cinco, porque o
 * valor está justamente em nenhum deles divergir depois.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada } from "./fixture-de-teste.mjs";
import { situacaoDoTenant, galeriasNoAr } from "../src/lib/assinatura.ts";
import { quotaEfetivaBytes, TETO_TRIAL_GB } from "../src/config/trial.ts";
import { SITUACOES, receitaMensalCentavos } from "../src/lib/metricas-admin.ts";
import { planos } from "../src/config/planos.ts";

exigirBancoDeTeste();

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

const GB = 1024 ** 3;
const ONTEM = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
/* Uma quota BEM acima do teto do trial: é a diferença entre os dois que prova
   que o teto sumiu, e não o acaso de o número ser pequeno. */
const QUOTA = String(BigInt(250) * BigInt(GB));

console.log("O status de cortesia:\n");

console.log("acesso — cortesia se comporta como ativo\n");

await etapa("pode enviar, mesmo com a data do trial no passado", () => {
  const s = situacaoDoTenant(
    { status: "cortesia", trial_ate: ONTEM, pago_ate: null, ciclo_cobranca: "mensal" },
    true,
  );
  if (!s.podeEnviar) throw new Error(`recusou: ${s.motivo ?? "sem motivo"}`);
  return "podeEnviar";
});

await etapa("não paga o teto do trial", () => {
  const cheia = quotaEfetivaBytes({ status: "cortesia", quota_bytes: QUOTA });
  if (cheia !== BigInt(QUOTA)) {
    throw new Error(`quota efetiva veio ${cheia}, esperava a cheia (${QUOTA})`);
  }
  /* E o contraste: o mesmo tenant em trial continua no teto. Sem esta metade, a
     etapa passaria mesmo se o teto tivesse sumido para todo mundo. */
  const emTrial = quotaEfetivaBytes({ status: "trial", quota_bytes: QUOTA });
  if (emTrial !== BigInt(TETO_TRIAL_GB) * BigInt(GB)) {
    throw new Error(`o teto do trial mudou junto: ${emTrial}`);
  }
  return `250 GB contra ${TETO_TRIAL_GB} GB do trial`;
});

await etapa("as galerias dela ficam no ar", () => {
  if (!galeriasNoAr({ status: "cortesia", trial_ate: ONTEM })) {
    throw new Error("as galerias sairiam do ar");
  }
});

console.log("\nreceita — cortesia NÃO é dinheiro\n");

await etapa("não entra na receita recorrente", () => {
  const plano = planos[0];
  const base = { plano_id: plano.id, ciclo_cobranca: "mensal", bytes_no_ar: "0", bytes_no_cofre: "0" };
  const comAtivo = receitaMensalCentavos([{ ...base, status: "ativo" }]);
  if (comAtivo !== plano.precoCentavos) {
    throw new Error(`o ativo rendeu ${comAtivo}, esperava ${plano.precoCentavos}`);
  }
  const comCortesia = receitaMensalCentavos([{ ...base, status: "cortesia" }]);
  if (comCortesia !== 0) {
    throw new Error(`a cortesia entrou como ${comCortesia} centavos de receita`);
  }
  return `ativo ${comAtivo} · cortesia 0`;
});

await etapa("o painel conhece a situação", () => {
  if (!SITUACOES.includes("cortesia")) {
    throw new Error(`SITUACOES é ${JSON.stringify(SITUACOES)} — o painel não saberia agrupar`);
  }
  return SITUACOES.join(", ");
});

console.log("\no banco\n");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

await etapa("a coluna aceita 'cortesia'", async () => {
  const t = await estudioDaRodada(db);
  const antes = t.status;
  try {
    await db.query("update tenants set status = 'cortesia' where id = $1", [t.id]);
    const { rows } = await db.query("select status from tenants where id = $1", [t.id]);
    if (rows[0].status !== "cortesia") throw new Error(`gravou ${rows[0].status}`);
    return "check atualizado";
  } finally {
    await db.query("update tenants set status = $2 where id = $1", [t.id, antes]);
  }
});

await etapa("a coluna continua recusando um status inventado", async () => {
  const t = await estudioDaRodada(db);
  try {
    await db.query("update tenants set status = 'vip' where id = $1", [t.id]);
  } catch {
    return "check ainda protege";
  }
  await db.query("update tenants set status = 'trial' where id = $1", [t.id]);
  throw new Error("o banco aceitou um status que não existe");
});

await db.end();

console.log(falhou ? "\n✗ a cortesia tem problema" : "\n✓ cortesia ok");
process.exit(falhou ? 1 : 0);
