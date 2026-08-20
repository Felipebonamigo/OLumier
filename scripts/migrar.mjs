#!/usr/bin/env node
/**
 * Controle de migrações do banco.
 *
 *   ... scripts/migrar.mjs              → lista o que falta (não muda nada)
 *   ... scripts/migrar.mjs --aplicar    → aplica as pendentes
 *   ... scripts/migrar.mjs --marcar     → registra como aplicadas SEM executar
 *
 * Por que existe: até agora as migrações eram aplicadas na mão, sem registro
 * nenhum de quais já tinham rodado. Isso funciona enquanto uma pessoa só faz o
 * deploy e lembra de tudo — e falha exatamente no dia em que alguém publica
 * código que depende de uma coluna que ninguém criou. O sintoma aparece para o
 * usuário, não para quem publicou.
 *
 * O `--marcar` existe por causa dessa história: as migrações 001–007 já foram
 * aplicadas à mão, e reexecutá-las seria no melhor caso barulho e no pior um
 * erro. Ele fecha a lacuna entre o que o banco já tem e o que o registro sabe.
 *
 * Cada migração roda dentro de uma TRANSAÇÃO: se falhar no meio, nada fica
 * pela metade — que é o estado mais difícil de consertar.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const PASTA = path.resolve(import.meta.dirname, "..", "db", "migracoes");
const APLICAR = process.argv.includes("--aplicar");
const MARCAR = process.argv.includes("--marcar");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  await db.query(`
    create table if not exists migracoes_aplicadas (
      arquivo     text primary key,
      aplicada_em timestamptz not null default now(),
      observacao  text
    )
  `);

  const noDisco = readdirSync(PASTA)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 001, 002, … — a ordem do nome É a ordem de aplicação

  const { rows } = await db.query("select arquivo from migracoes_aplicadas");
  const jaAplicadas = new Set(rows.map((r) => r.arquivo));
  const pendentes = noDisco.filter((f) => !jaAplicadas.has(f));

  if (pendentes.length === 0) {
    console.log(`✓ banco em dia — ${noDisco.length} migração(ões), nenhuma pendente`);
    process.exit(0);
  }

  console.log(`${pendentes.length} migração(ões) pendente(s):`);
  for (const f of pendentes) console.log(`  · ${f}`);

  if (MARCAR) {
    for (const f of pendentes) {
      await db.query(
        "insert into migracoes_aplicadas (arquivo, observacao) values ($1, $2) on conflict do nothing",
        [f, "aplicada à mão antes do controle existir"],
      );
    }
    console.log(`\n✓ ${pendentes.length} registrada(s) como aplicadas — NADA foi executado`);
    process.exit(0);
  }

  if (!APLICAR) {
    console.log("\nNada foi executado. Para aplicar: --aplicar");
    // Código 2 (não 1) para o deploy distinguir "há pendências" de "o script quebrou".
    process.exit(2);
  }

  for (const f of pendentes) {
    const sql = readFileSync(path.join(PASTA, f), "utf8");
    process.stdout.write(`  aplicando ${f}… `);
    try {
      await db.query("begin");
      await db.query(sql);
      await db.query("insert into migracoes_aplicadas (arquivo) values ($1)", [f]);
      await db.query("commit");
      console.log("ok");
    } catch (e) {
      await db.query("rollback");
      console.log("FALHOU");
      console.error(`\n✗ ${f}: ${e.message}`);
      console.error("  nada desta migração foi aplicado (rollback)");
      process.exit(1);
    }
  }
  console.log(`\n✓ ${pendentes.length} migração(ões) aplicada(s)`);
} finally {
  await db.end();
}
