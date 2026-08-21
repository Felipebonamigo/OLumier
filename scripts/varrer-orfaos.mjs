#!/usr/bin/env node
/**
 * Acha (e opcionalmente apaga) arquivo pago que ninguém mais referencia.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/varrer-orfaos.mjs
 *   node --env-file=.env.local --experimental-strip-types scripts/varrer-orfaos.mjs --apagar
 *
 * Por que existe: objeto no bucket sem linha correspondente é invisível — não
 * aparece no painel, não conta na quota, não aparece em relatório nenhum — e
 * continua sendo cobrado todo mês. O jeito de descobrir é comparar as listas.
 *
 * Como isso acontece: galeria apagada antes da correção de 20/08/2026, upload
 * interrompido entre o PUT e a confirmação, logo trocada, ou um teste que morreu
 * no meio.
 *
 * SEM `--apagar` ele só relata. Apagar arquivo é irreversível, então a ação
 * destrutiva precisa ser pedida explicitamente.
 */
import pg from "pg";
import { listarObjetos, apagarObjetos, BUCKET } from "../src/lib/r2.ts";
import { chavesConhecidas } from "./varrer-orfaos-regras.mjs";

const APAGAR = process.argv.includes("--apagar");

/*
 * Margem de segurança: entre o PUT no bucket e a confirmação no banco existe uma
 * janela em que o objeto é, tecnicamente, órfão. Sem esta margem a varredura
 * apagaria o arquivo de quem está enviando NESTE momento — o pior jeito possível
 * de "limpar".
 *
 * Esta constante existia desde o começo e o comentário prometia exatamente isso,
 * mas o filtro nunca usava a idade: a promessa estava no comentário e não no
 * código. Corrigido em 21/08/2026.
 */
const IDADE_MINIMA_H = 24;

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

console.log(`bucket: ${BUCKET}\n`);

const doBucket = await listarObjetos();
console.log(`  objetos no bucket: ${doBucket.length}`);

const conhecidas = await chavesConhecidas(db);
console.log(`  chaves conhecidas pelo banco: ${conhecidas.size}`);

const corte = Date.now() - IDADE_MINIMA_H * 3600 * 1000;
const candidatos = doBucket.filter((o) => !conhecidas.has(o.chave));

// Sem data conhecida, trata como recente: na dúvida, não apaga.
const novosDemais = candidatos.filter((o) => !o.modificadoEm || o.modificadoEm.getTime() > corte);
const orfaos = candidatos.filter((o) => o.modificadoEm && o.modificadoEm.getTime() <= corte);

if (novosDemais.length > 0) {
  console.log(
    `  ${novosDemais.length} sem dono, mas com menos de ${IDADE_MINIMA_H}h — podem ser envios em andamento, preservados`,
  );
}

if (orfaos.length === 0) {
  console.log("\n✓ nenhum órfão — bucket e banco batem\n");
  await db.end();
  process.exit(0);
}

console.log(`\n  ⚠ órfãos encontrados: ${orfaos.length}`);
for (const o of orfaos.slice(0, 20)) console.log(`     ${o.chave}`);
if (orfaos.length > 20) console.log(`     … e mais ${orfaos.length - 20}`);

if (!APAGAR) {
  console.log(
    `\nNada foi apagado. Para remover de verdade:\n` +
      `  node --env-file=.env.local --experimental-strip-types scripts/varrer-orfaos.mjs --apagar\n`,
  );
  await db.end();
  process.exit(0);
}

// Confere de novo, agora contra o banco lido AGORA: entre a listagem e este
// ponto alguém pode ter confirmado um upload ou salvo uma logo.
const conhecidas2 = await chavesConhecidas(db);
const aindaOrfaos = orfaos.map((o) => o.chave).filter((c) => !conhecidas2.has(c));
const salvos = orfaos.length - aindaOrfaos.length;
if (salvos > 0) console.log(`  (${salvos} deixaram de ser órfãos durante a varredura — preservados)`);

console.log(`\n  apagando ${aindaOrfaos.length}…`);
await apagarObjetos(aindaOrfaos);
console.log(`✓ ${aindaOrfaos.length} objeto(s) órfão(s) removidos — deixaram de ser cobrados\n`);

await db.end();
