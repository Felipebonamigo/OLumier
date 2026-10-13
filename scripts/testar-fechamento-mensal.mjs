#!/usr/bin/env node
/**
 * O FECHAMENTO MENSAL e a tabela "Mês a mês" da Administração. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-fechamento-mensal.mjs
 *
 * A parte da página precisa do servidor de desenvolvimento E de um estúdio cujo
 * e-mail esteja em `ADMINS` — sem isso ela PULA, como `testar-indice-do-admin`.
 *
 * ── O PEDIDO (09/10/2026) ──────────────────────────────────────────────────
 *
 * Felipe, olhando a Administração: "aqui vamos separar por mês as contas
 * também, para termos o controle dos custos, gastos, etc."
 *
 * ── O QUE ESTE ARQUIVO MAIS PRENDE ─────────────────────────────────────────
 *
 *   1. A HONESTIDADE DA TABELA. Cadastros e total de contas são exatos em todo
 *      mês (têm data no banco); o resto só existe onde houve gravação. Mês sem
 *      linha é "sem registro", nunca zero e nunca estimativa.
 *   2. O MÊS QUE PASSOU NÃO SE MEXE. Uma linha fechada é o retrato do fim do
 *      mês; regravá-la depois falsificaria o histórico que a tabela existe
 *      para guardar.
 *   3. A linha gravada tem os MESMOS números do bloco Dinheiro — as duas saem de
 *      `resumoDaPlataforma`, e a conferência é feita contra o banco cru.
 *   4. O mês é o de BRASÍLIA: uma conta criada às 22h30 do dia 31 é do mês do
 *      dia 31, e não do seguinte (que é o que o UTC diria).
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, segundoEstudioDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import {
  mesDeBrasilia,
  mesesAte,
  montarMesAMes,
  numerosDoMes,
} from "../src/lib/fechamento-mensal-regras.ts";
import { resumoDaPlataforma } from "../src/lib/metricas-admin.ts";
import { fechamentoDoMes, gravarFechamentoDoMes, mesAMes } from "../src/lib/fechamento-mensal.ts";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
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
  if (JSON.stringify(a, (_, v) => (typeof v === "bigint" ? v.toString() : v)) !== JSON.stringify(b, (_, v) => (typeof v === "bigint" ? v.toString() : v))) {
    throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
  }
};

/* Meses de mentira, bem longe do que o banco de teste usa: nada aqui pode
   tocar numa linha de verdade. Limpo no fim, e ANTES, se uma rodada anterior
   morreu no meio. */
const MESES_DE_TESTE = ["2031-01", "2031-02", "2031-03"];
const limparLinhas = () => db.query("delete from fechamentos_mensais where mes = any($1)", [MESES_DE_TESTE]);
await limparLinhas();

console.log("\nAs regras (sem banco)\n");

await etapa("os meses vão do mais novo para o mais antigo, e atravessam o ano", () => {
  igual(mesesAte("2026-10", 3), ["2026-10", "2026-09", "2026-08"], "três meses");
  igual(mesesAte("2026-02", 4), ["2026-02", "2026-01", "2025-12", "2025-11"], "virada de ano");
  igual(mesesAte("2026-10", 12).length, 12, "doze");
});

await etapa("o mês é o de Brasília: 22h30 do dia 31 ainda é o mês do dia 31", () => {
  igual(mesDeBrasilia(new Date("2026-10-01T01:30:00Z")), "2026-09", "01h30 UTC = 22h30 de 30/09 em Brasília");
  igual(mesDeBrasilia(new Date("2026-10-01T03:00:00Z")), "2026-10", "03h00 UTC = 00h00 de 01/10 em Brasília");
});

const hoje = new Date("2026-10-09T15:00:00Z");
const estudiosDeMentira = [
  { id: "a", status: "ativo", plano_id: "foto-100", ciclo_cobranca: "mensal", criado_em: "2026-09-10T12:00:00Z", trial_ate: null, quota_bytes: "1", bytes_no_ar: "0", bytes_no_cofre: "0" },
  { id: "b", status: "trial", plano_id: "foto-100", ciclo_cobranca: "mensal", criado_em: "2026-10-01T01:30:00Z", trial_ate: "2026-10-15T00:00:00Z", quota_bytes: "1", bytes_no_ar: "0", bytes_no_cofre: "0" },
  { id: "c", status: "cancelado", plano_id: "foto-100", ciclo_cobranca: "mensal", criado_em: "2026-10-05T12:00:00Z", trial_ate: null, quota_bytes: "1", bytes_no_ar: "0", bytes_no_cofre: "0" },
];

await etapa("os números do mês saem do mesmo resumo do bloco Dinheiro", () => {
  const r = resumoDaPlataforma(estudiosDeMentira, hoje, 1000);
  const n = numerosDoMes(estudiosDeMentira, r, "2026-10", 0);
  igual(n.estudios, 3, "estúdios");
  igual(n.pagando, r.porStatus.ativo, "pagando");
  igual(n.emTeste, r.porStatus.trial, "em teste");
  igual(n.cancelados, r.porStatus.cancelado, "cancelados");
  igual(n.receitaCentavos, r.receitaMensalCentavos, "receita");
  igual(n.custoFixoCentavos, 1000, "custo fixo");
  igual(n.resultadoCentavos, r.resultadoMensalCentavos, "resultado");
});

await etapa("'novos' conta o mês de BRASÍLIA: a conta de 01h30 UTC de 01/10 nasceu em setembro", () => {
  const r = resumoDaPlataforma(estudiosDeMentira, hoje, 0);
  igual(numerosDoMes(estudiosDeMentira, r, "2026-09", 0).novos, 2, "setembro: a de 10/09 e a de 22h30 de 30/09");
  igual(numerosDoMes(estudiosDeMentira, r, "2026-10", 0).novos, 1, "outubro: só a de 05/10");
});

await etapa("a tabela: cadastros e total exatos; mês sem linha é null, e o corrente vem 'ao vivo'", () => {
  const meses = mesesAte("2026-10", 4); // 10, 09, 08, 07
  const r = resumoDaPlataforma(estudiosDeMentira, hoje, 0);
  const vivo = numerosDoMes(estudiosDeMentira, r, "2026-10", 0);
  const gravadaDeSetembro = {
    mes: "2026-09", registrado_em: new Date("2026-09-30T07:50:00Z"), estudios: 2, novos: 2, pagando: 1,
    em_teste: 1, inadimplentes: 0, cancelados: 0, cortesias: 0, bytes_guardados: "5000000000",
    receita_centavos: 4990, custo_guardado_centavos: 120, custo_fixo_centavos: 7000,
    cortesias_centavos: 0, resultado_centavos: -2130,
  };
  const linhas = montarMesAMes(meses, { "2026-10": 1, "2026-09": 2, "2026-08": 3 }, 4, [gravadaDeSetembro], vivo, "2026-10");
  igual(linhas.map((l) => l.mes), ["2026-10", "2026-09", "2026-08", "2026-07"], "ordem");
  igual(linhas.map((l) => l.cadastros), [1, 2, 3, 0], "cadastros por mês");
  /* 4 antes de julho; julho +0, agosto +3, setembro +2, outubro +1. */
  igual(linhas.map((l) => l.contasNoFim), [10, 9, 7, 4], "total ao fim de cada mês");
  igual(linhas[0].aoVivo, true, "o corrente é ao vivo");
  igual(linhas[0].numeros.pagando, 1, "o ao vivo usa os números de agora");
  igual(linhas[0].registradoEm, null, "o ao vivo não tem data de gravação");
  igual(linhas[1].numeros.pagando, 1, "setembro vem da linha gravada");
  igual(linhas[1].numeros.bytesGuardados, 5000000000n, "bytes como bigint");
  igual(linhas[1].registradoEm.toISOString(), "2026-09-30T07:50:00.000Z", "a data da gravação aparece");
  igual(linhas[2].numeros, null, "agosto não tem linha: sem registro, e NÃO zero");
  igual(linhas[3].numeros, null, "julho idem");
});

await etapa("os meses anteriores à primeira conta não entram na tabela", () => {
  /*
   * Pedido do Felipe (13/10/2026), junto com o gráfico acima: a janela de doze
   * meses enchia a tela de linhas de travessão nos meses em que a plataforma
   * não existia. "Zero conta, zero receita, zero resultado" não é um mês ruim
   * — é um mês que não houve.
   *
   * `contasNoFim` é soma corrida, então zero ali quer dizer que NADA existia
   * ainda. Por isso o corte olha esse total, e não `cadastros`: um mês sem
   * cadastro NOVO no meio da história tem contas de pé e precisa aparecer.
   */
  const meses = mesesAte("2026-10", 6); // 10, 09, 08, 07, 06, 05
  const r = resumoDaPlataforma(estudiosDeMentira, hoje, 0);
  const vivo = numerosDoMes(estudiosDeMentira, r, "2026-10", 0);
  /* Primeira conta em agosto, e NENHUMA antes da janela. */
  const linhas = montarMesAMes(meses, { "2026-10": 1, "2026-08": 3 }, 0, [], vivo, "2026-10");
  igual(linhas.map((l) => l.mes), ["2026-10", "2026-09", "2026-08"], "só de agosto para cá");
  /* Setembro ficou: não houve cadastro novo, mas as três contas de agosto
     estavam de pé. É o "mês vazio no meio" que tem de continuar visível. */
  igual(linhas[1].cadastros, 0, "setembro sem cadastro novo");
  igual(linhas[1].contasNoFim, 3, "e com as contas de agosto de pé");
});

await etapa("conta anterior à janela não corta nada: os doze meses têm história", () => {
  const meses = mesesAte("2026-10", 4);
  const r = resumoDaPlataforma(estudiosDeMentira, hoje, 0);
  const vivo = numerosDoMes(estudiosDeMentira, r, "2026-10", 0);
  const linhas = montarMesAMes(meses, {}, 2, [], vivo, "2026-10");
  igual(linhas.length, 4, "nenhum mês cortado");
  igual(linhas.at(-1).contasNoFim, 2, "as duas contas já existiam antes");
});

await etapa("o mês corrente NÃO usa a linha gravada, mesmo que exista: a tela mostra o dia", () => {
  const r = resumoDaPlataforma(estudiosDeMentira, hoje, 0);
  const vivo = numerosDoMes(estudiosDeMentira, r, "2026-10", 0);
  const velha = {
    mes: "2026-10", registrado_em: new Date("2026-10-01T07:50:00Z"), estudios: 99, novos: 0, pagando: 99,
    em_teste: 0, inadimplentes: 0, cancelados: 0, cortesias: 0, bytes_guardados: "0",
    receita_centavos: 1, custo_guardado_centavos: 1, custo_fixo_centavos: 1, cortesias_centavos: 0, resultado_centavos: 1,
  };
  const [corrente] = montarMesAMes(["2026-10"], { "2026-10": 1 }, 0, [velha], vivo, "2026-10");
  igual(corrente.numeros.pagando, 1, "pagando de agora, e não os 99 da linha de ontem");
});

console.log("\nO banco\n");

/* O relógio é conduzido: março de 2031, bem longe de qualquer linha real. */
const AGORA = new Date("2031-03-15T12:00:00Z");

await etapa("a tabela existe (migração 068)", async () => {
  const { rows } = await db.query("select to_regclass('public.fechamentos_mensais') as t");
  if (!rows[0].t) throw new Error("rode as migrações: a tabela fechamentos_mensais não existe");
});

await etapa("gravar cria a linha do mês, com os números do banco cru", async () => {
  const { mes, numeros } = await gravarFechamentoDoMes(AGORA);
  igual(mes, "2031-03", "o mês gravado");
  const { rows: [l] } = await db.query("select * from fechamentos_mensais where mes = $1", [mes]);
  if (!l) throw new Error("a linha não foi gravada");

  /* A conferência é contra o banco cru, e não contra a própria função. */
  const { rows: [t] } = await db.query(
    `select count(*)::int as total,
            count(*) filter (where status = 'ativo')::int as ativos,
            count(*) filter (where status = 'trial')::int as trial,
            count(*) filter (where status = 'cancelado')::int as cancelados,
            count(*) filter (where status = 'cortesia')::int as cortesias
       from tenants`,
  );
  igual(l.estudios, t.total, "estúdios");
  igual(l.pagando, t.ativos, "pagando");
  igual(l.em_teste, t.trial, "em teste");
  igual(l.cancelados, t.cancelados, "cancelados");
  igual(l.cortesias, t.cortesias, "cortesias");
  igual(l.resultado_centavos, numeros.resultadoCentavos, "resultado");
  igual(l.resultado_centavos, l.receita_centavos - l.custo_guardado_centavos - l.custo_fixo_centavos, "resultado = receita − guardado − fixo");
  return `${l.estudios} contas, ${l.pagando} pagando`;
});

await etapa("gravar de novo REGRAVA a mesma linha (uma por mês) e atualiza a data", async () => {
  const antes = (await db.query("select registrado_em from fechamentos_mensais where mes = '2031-03'")).rows[0].registrado_em;
  await new Promise((ok) => setTimeout(ok, 15));
  await gravarFechamentoDoMes(AGORA);
  const { rows } = await db.query("select registrado_em from fechamentos_mensais where mes = '2031-03'");
  igual(rows.length, 1, "linhas do mês");
  if (!(rows[0].registrado_em > antes)) throw new Error("a data da gravação não andou");
});

await etapa("o mês que passou NÃO é tocado", async () => {
  await db.query(
    `insert into fechamentos_mensais (mes, registrado_em, estudios, novos, pagando, em_teste, inadimplentes,
       cancelados, cortesias, bytes_guardados, receita_centavos, custo_guardado_centavos, custo_fixo_centavos,
       cortesias_centavos, resultado_centavos)
     values ('2031-02', '2031-02-28T07:50:00Z', 11, 2, 5, 4, 1, 1, 0, 123456789, 40000, 900, 7000, 0, 32100)`,
  );
  const antes = (await db.query("select * from fechamentos_mensais where mes = '2031-02'")).rows[0];
  await gravarFechamentoDoMes(AGORA); // março: só março
  await gravarFechamentoDoMes(AGORA);
  const depois = (await db.query("select * from fechamentos_mensais where mes = '2031-02'")).rows[0];
  igual(depois, antes, "a linha de fevereiro");
});

await etapa("a simulação calcula e NÃO grava", async () => {
  await db.query("delete from fechamentos_mensais where mes = '2031-03'");
  const { mes } = await fechamentoDoMes(AGORA);
  igual(mes, "2031-03", "o mês calculado");
  const { rows } = await db.query("select 1 from fechamentos_mensais where mes = '2031-03'");
  igual(rows.length, 0, "linhas gravadas");
});

console.log("\nA tabela, contra o banco\n");

/* Dois estúdios com data marcada em janeiro de 2031. O segundo nasceu às 01h30
   UTC de 1º de fevereiro — 22h30 de 31/01 em Brasília — e por isso é de JANEIRO. */
const a = await estudioDaRodada(db);
const b = await segundoEstudioDaRodada(db);
await db.query("update tenants set criado_em = '2031-01-20T15:00:00Z' where id = $1", [a.id]);
await db.query("update tenants set criado_em = '2031-02-01T01:30:00Z' where id = $1", [b.id]);

await etapa("os cadastros são do mês de Brasília, e o total fecha com o banco", async () => {
  const { numeros } = await fechamentoDoMes(AGORA);
  const linhas = await mesAMes(numeros, 12, AGORA);
  igual(linhas.length, 12, "doze meses");
  igual(linhas[0].mes, "2031-03", "o mais novo primeiro");
  igual(linhas[11].mes, "2030-04", "o mais antigo por último");
  const por = Object.fromEntries(linhas.map((l) => [l.mes, l]));
  igual(por["2031-01"].cadastros, 2, "janeiro: os dois, inclusive o das 22h30 do dia 31");
  igual(por["2031-02"].cadastros, 0, "fevereiro: nenhum (o das 01h30 UTC é de janeiro em Brasília)");
  igual(por["2031-03"].cadastros, 0, "março: nenhum");
  const { rows: [t] } = await db.query("select count(*)::int as n from tenants");
  igual(por["2031-03"].contasNoFim, t.n, "março fecha com todas as contas do banco");
  igual(por["2031-01"].contasNoFim, t.n, "janeiro também: ninguém nasceu depois");
  igual(por["2030-12"].contasNoFim, t.n - 2, "dezembro: sem os dois de janeiro");
});

await etapa("meses sem linha são 'sem registro' (null), e o gravado aparece com a sua data", async () => {
  const { numeros } = await fechamentoDoMes(AGORA);
  const linhas = await mesAMes(numeros, 12, AGORA);
  const por = Object.fromEntries(linhas.map((l) => [l.mes, l]));
  igual(por["2031-03"].aoVivo, true, "março é o corrente");
  igual(por["2031-03"].numeros !== null, true, "março tem números (ao vivo)");
  igual(por["2031-02"].numeros.pagando, 5, "fevereiro vem da linha gravada");
  igual(por["2031-02"].registradoEm.toISOString(), "2031-02-28T07:50:00.000Z", "e mostra a data dela");
  igual(por["2031-01"].numeros, null, "janeiro não tem linha");
  igual(por["2030-06"].numeros, null, "junho de 2030 idem");
});

await etapa("sem a tabela de fechamento, a leitura ainda devolve o que é exato", async () => {
  /* A página não pode cair por causa da tabela: `mesAMes` engole a falta dela. */
  await db.query("alter table fechamentos_mensais rename to fechamentos_mensais_fora");
  try {
    const linhas = await mesAMes(null, 3, AGORA);
    igual(linhas.length, 3, "três meses");
    igual(linhas.every((l) => l.numeros === null), true, "tudo sem registro");
    igual(linhas.find((l) => l.mes === "2031-01").cadastros, 2, "mas os cadastros seguem exatos");
  } finally {
    await db.query("alter table fechamentos_mensais_fora rename to fechamentos_mensais");
  }
});

console.log("\nA página\n");

const admins = (process.env.ADMINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
let servidor = false;
try {
  servidor = (await fetch(`${BASE}/api/healthz`, { signal: AbortSignal.timeout(4000) })).ok;
} catch {
  servidor = false;
}
const { rows: donos } = admins.length
  ? await db.query("select id from tenants where lower(email) = any($1) limit 1", [admins])
  : { rows: [] };

if (!servidor || donos.length === 0) {
  console.log("  ⚠ sem servidor ou sem estúdio de admin no banco (ADMINS) — a parte da página foi pulada");
} else {
  const cookie = cookieDeSessao(donos[0].id);
  const html = await (await fetch(`${BASE}/painel/admin`, { headers: { cookie }, cache: "no-store" })).text();

  await etapa("a Administração tem o bloco 'Mês a mês', com âncora e no índice", () => {
    if (!/<section id="mes-a-mes"[^>]*>/.test(html)) throw new Error("não achei o bloco com id mes-a-mes");
    if (!/href="#mes-a-mes"/.test(html)) throw new Error("o bloco não está no índice do topo");
  });

  await etapa("a tabela começa na primeira conta, marca o corrente e avisa o sem registro", async () => {
    const bloco = html.slice(html.indexOf('<section id="mes-a-mes"'), html.indexOf("</section>", html.indexOf('<section id="mes-a-mes"')));
    const linhas = [...bloco.matchAll(/<tr class="border-t/g)];
    /* Doze era o número fixo até 13/10/2026, quando o começo vazio deixou de
       entrar. O número agora depende do banco: conta da janela até a primeira
       conta, ou doze se a primeira é mais velha que a janela. */
    const { rows } = await db.query(`
      select to_char(date_trunc('month', now() at time zone 'America/Sao_Paulo') - make_interval(months => 11), 'YYYY-MM') as janela,
             to_char(min(date_trunc('month', criado_em at time zone 'America/Sao_Paulo')), 'YYYY-MM') as primeiro
        from tenants
    `);
    const { janela, primeiro } = rows[0];
    const de = primeiro && primeiro > janela ? primeiro : janela;
    const [ya, ma] = de.split("-").map(Number);
    const agora = new Date();
    const esperado = agora.getFullYear() * 12 + (agora.getMonth() + 1) - (ya * 12 + ma) + 1;
    igual(linhas.length, esperado, "linhas da tabela");
    if (linhas.length > 12) throw new Error("a janela de doze meses estourou");
    if (!bloco.includes("em andamento")) throw new Error("o mês corrente não está marcado");
    if (!bloco.includes("sem registro")) throw new Error("os meses sem linha não dizem 'sem registro'");
    if (!/\/painel\/admin\/caixa\?mes=\d{4}-\d{2}/.test(bloco)) throw new Error("falta o atalho para o Caixa do mês");
  });
}

await limparLinhas();
await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ fechamento mensal com falha\n" : "\n✓ fechamento mensal ok\n");
process.exit(falhou ? 1 : 0);
