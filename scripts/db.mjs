#!/usr/bin/env node
/**
 * Aplica um arquivo .sql no banco. Uso:
 *   node --env-file=.env.local scripts/db.mjs db/schema.sql
 *
 * Mesmo padrão já usado no Atomatiza: migração roda por script, não pelo painel.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const arquivo = process.argv[2];
if (!arquivo) {
  console.error("uso: node --env-file=.env.local scripts/db.mjs <arquivo.sql>");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definida — confira o .env.local");
  process.exit(1);
}

const sql = readFileSync(arquivo, "utf8");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  await client.query(sql);
  console.log(`✓ aplicado: ${arquivo}`);
} catch (e) {
  console.error(`✗ falhou: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
