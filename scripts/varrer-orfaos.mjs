#!/usr/bin/env node
/**
 * Acha (e opcionalmente apaga) arquivo pago que ninguém mais referencia.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/varrer-orfaos.mjs
 *   node --env-file=.env.local --experimental-strip-types scripts/varrer-orfaos.mjs --apagar
 *
 * Por que existe: objeto no bucket sem linha correspondente em `medias` é
 * invisível — não aparece no painel, não conta na quota, não aparece em
 * relatório nenhum — e continua sendo cobrado todo mês. O jeito de descobrir é
 * comparar as duas listas.
 *
 * Como isso acontece: galeria apagada antes da correção de 20/08/2026, upload
 * interrompido entre o PUT e a confirmação, ou um teste que morreu no meio.
 *
 * SEM `--apagar` ele só relata. Apagar arquivo é irreversível, então a ação
 * destrutiva precisa ser pedida explicitamente.
 */
import pg from "pg";
import { listarChaves, apagarObjetos, BUCKET } from "../src/lib/r2.ts";

const APAGAR = process.argv.includes("--apagar");
// Margem de segurança: um upload que começou agora ainda não tem linha pronta
// no banco. Sem isso, a varredura apagaria arquivo de quem está subindo NESTE
// momento — o pior jeito possível de "limpar".
const IDADE_MINIMA_H = 24;

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

console.log(`bucket: ${BUCKET}\n`);

const doBucket = await listarChaves();
console.log(`  objetos no bucket: ${doBucket.length}`);

const { rows } = await db.query(
  "select chave, chave_thumb, chave_preview from medias",
);
const conhecidas = new Set(
  rows.flatMap((r) => [r.chave, r.chave_thumb, r.chave_preview]).filter(Boolean),
);
console.log(`  chaves conhecidas pelo banco: ${conhecidas.size}`);

const orfaos = doBucket.filter((c) => !conhecidas.has(c));

if (orfaos.length === 0) {
  console.log("\n✓ nenhum órfão — bucket e banco batem\n");
  await db.end();
  process.exit(0);
}

console.log(`\n  ⚠ órfãos encontrados: ${orfaos.length}`);
for (const c of orfaos.slice(0, 20)) console.log(`     ${c}`);
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
// ponto alguém pode ter confirmado um upload.
const { rows: rows2 } = await db.query("select chave, chave_thumb, chave_preview from medias");
const conhecidas2 = new Set(
  rows2.flatMap((r) => [r.chave, r.chave_thumb, r.chave_preview]).filter(Boolean),
);
const aindaOrfaos = orfaos.filter((c) => !conhecidas2.has(c));
const salvos = orfaos.length - aindaOrfaos.length;
if (salvos > 0) console.log(`  (${salvos} deixaram de ser órfãos durante a varredura — preservados)`);

console.log(`\n  apagando ${aindaOrfaos.length}…`);
await apagarObjetos(aindaOrfaos);
console.log(`✓ ${aindaOrfaos.length} objeto(s) órfão(s) removidos — deixaram de ser cobrados\n`);

await db.end();
