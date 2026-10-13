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
import { readFileSync } from "node:fs";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada } from "./fixture-de-teste.mjs";
import { situacaoDoTenant, galeriasNoAr } from "../src/lib/assinatura.ts";
import { quotaEfetivaBytes, espacoSemLimite, TETO_TRIAL_GB } from "../src/config/trial.ts";
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
const emGb = (b) => `${(Number(b) / GB).toFixed(0)} GB`;

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

/*
 * ── SEM LIMITE DE ESPAÇO (16/09/2026) ─────────────────────────────────────
 *
 * Felipe: "o da Sirius e da Carol não tem vencimento, pode deixar ilimitado".
 * Cortesia é a conta dos sócios; a quota do plano deixa de valer para ela.
 * Aumentar o número no banco não servia: a troca de plano e o
 * `sincronizar-quotas` regravam `quota_bytes` e o limite voltaria calado.
 */
await etapa("não tem limite de espaço", () => {
  if (!espacoSemLimite({ status: "cortesia" })) throw new Error("a cortesia ainda tem limite");
  const cortesia = quotaEfetivaBytes({ status: "cortesia", quota_bytes: QUOTA });
  const umPetabyte = BigInt(1024) ** BigInt(5);
  if (cortesia < umPetabyte) {
    throw new Error(`quota efetiva veio ${emGb(cortesia)}, a do plano`);
  }
  /* O contraste: quem PAGA continua com a quota do plano. */
  if (espacoSemLimite({ status: "ativo" })) throw new Error("o ativo ficou sem limite junto");
  if (quotaEfetivaBytes({ status: "ativo", quota_bytes: QUOTA }) !== BigInt(QUOTA)) {
    throw new Error("a quota do ativo mudou junto");
  }
  return "cortesia sem limite · ativo com a do plano";
});

await etapa("não paga o teto do trial", () => {
  const cheia = quotaEfetivaBytes({ status: "cortesia", quota_bytes: QUOTA });
  if (cheia < BigInt(QUOTA)) {
    throw new Error(`quota efetiva veio ${cheia}, abaixo da do plano (${QUOTA})`);
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

/*
 * A tarefa diária avisa quem passou do espaço (`estudiosAcimaDoEspaco`). Ela
 * lia a coluna `quota_bytes` direto — e a Carol, com 1250 GB no plano e sem
 * limite na prática, viraria um aviso falso todo dia depois de 1250 GB.
 */
await etapa("a tarefa diária não acusa cortesia acima da quota do plano", async () => {
  const { galeriaDaRodada } = await import("./fixture-de-teste.mjs");
  const { estudiosAcimaDoEspaco } = await import("../src/lib/cofre.ts");
  const t = await estudioDaRodada(db);
  await galeriaDaRodada(db, { nome: "cortesia-espaco", medias: 1, bytes: 5000 });
  const { rows: [antes] } = await db.query("select status, quota_bytes from tenants where id = $1", [t.id]);
  try {
    await db.query("update tenants set quota_bytes = 1, status = 'ativo' where id = $1", [t.id]);
    const comAtivo = (await estudiosAcimaDoEspaco()).some((e) => e.email === t.email);
    if (!comAtivo) throw new Error("nem o pagante acima da quota foi acusado — a etapa não prova nada");
    await db.query("update tenants set status = 'cortesia' where id = $1", [t.id]);
    const comCortesia = (await estudiosAcimaDoEspaco()).some((e) => e.email === t.email);
    if (comCortesia) throw new Error("a cortesia foi acusada de passar de um limite que ela não tem");
    return "pagante acusado · cortesia não";
  } finally {
    await db.query("update tenants set status = $2, quota_bytes = $3 where id = $1", [
      t.id,
      antes.status,
      antes.quota_bytes,
    ]);
  }
});

console.log("\nas telas\n");

/*
 * Sem limite, "4 GB de 4 EB" na barra do topo e na tela da conta leria como
 * defeito. As telas perguntam `espacoSemLimite` e dizem "sem limite".
 */
await etapa("o painel diz 'sem limite', não um número absurdo", () => {
  const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const faltam = [
    "src/app/painel/layout.tsx",
    "src/app/painel/conta/page.tsx",
    /* A célula de espaço de cada estúdio mora aqui desde que a tabela passou a
       ordenar no navegador (13/10/2026); antes morava na própria página. */
    "src/components/admin-celulas-do-estudio.tsx",
    "src/app/painel/admin/estudios/[id]/page.tsx",
  ].filter((p) => !/espacoSemLimite\(/.test(ler(p)) || !/sem limite/.test(ler(p)));
  if (faltam.length) throw new Error(`sem o tratamento: ${faltam.join(", ")}`);
  return "4 telas";
});

await etapa("o admin mostra o custo de cada conta, e o que cobrar por fora", () => {
  const admin = readFileSync(new URL("../src/app/painel/admin/page.tsx", import.meta.url), "utf8");
  /* Os títulos das colunas moram em `lib/ordem-dos-estudios.ts` desde que a
     tabela passou a ordenar por coluna (30/09/2026), e as células de cada
     estúdio em `components/admin-celulas-do-estudio.tsx` desde que ela passou a
     ordenar no navegador (13/10/2026); a página monta a tabela. A coluna só
     existe se as três partes existirem. */
  const colunas = readFileSync(new URL("../src/lib/ordem-dos-estudios.ts", import.meta.url), "utf8");
  const celulas = readFileSync(new URL("../src/components/admin-celulas-do-estudio.tsx", import.meta.url), "utf8");
  if (
    !/"Custa por mês"/.test(colunas) ||
    !/COLUNAS_DOS_ESTUDIOS\.map/.test(admin) ||
    !/custoMensalDoEstudioCentavos\(/.test(celulas)
  ) {
    throw new Error("a tabela de estúdios não tem a coluna de custo");
  }
  if (!/a cobrar por fora/.test(celulas) || !/custoDasCortesiasCentavos\(/.test(admin)) {
    throw new Error("o admin não destaca o que cobrar das cortesias");
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
