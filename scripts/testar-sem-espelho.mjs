#!/usr/bin/env node
/**
 * O espelho FOI REMOVIDO — e esta guarda existe para ele não voltar sozinho.
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-sem-espelho.mjs
 *
 * ── O QUE ACONTECEU ───────────────────────────────────────────────────────
 * O espelho era a segunda cópia dos originais, num fornecedor diferente
 * (Backblaze B2, bucket `olumier-espelho`). Foi CANCELADO em 26/08/2026, junto
 * com a obra da rota B2 — a grade de preços foi recalculada sem ele
 * (R$ 0,0459/GB, ver `config/planos.ts`). Só que nada foi desligado: por um dia
 * inteiro dois temporizadores do systemd copiaram e purgaram arquivos para um
 * espelho que a empresa já tinha decidido não ter, e o banco continuou com duas
 * colunas de fila que ninguém consumia.
 *
 * ── POR QUE UMA GUARDA, E NÃO SÓ APAGAR ───────────────────────────────────
 * Remoção some do diff no dia seguinte. Quem abrir `medias.ts` daqui a três
 * meses e ler "a segunda cópia é o que sobra quando tudo falhou" — comentário
 * que sobreviveu à decisão — vai reconstruir o espelho de boa fé. Esta guarda é
 * o lugar onde a decisão fica escrita de um jeito que o teste cobra.
 *
 * ── SE UM DIA O ESPELHO VOLTAR ────────────────────────────────────────────
 * Apague este arquivo no MESMO commit que traz o espelho de volta. Guarda que
 * sobrevive à decisão que ela protegia é ruído, e a próxima pessoa perde tempo
 * decidindo se a guarda ou o código é que está errado.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";

exigirBancoDeTeste();

const RAIZ = path.resolve(import.meta.dirname, "..");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

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

console.log("O espelho não existe mais:\n");

/* ── os arquivos ─────────────────────────────────────────────────────────── */

await etapa("a biblioteca do espelho não existe", () => {
  if (existsSync(path.join(RAIZ, "src/lib/espelho.ts"))) {
    throw new Error("src/lib/espelho.ts voltou");
  }
});

await etapa("os scripts do espelho não existem", () => {
  const mortos = ["espelhar.mjs", "purgar-espelho.mjs", "testar-espelho.mjs", "testar-purga-espelho.mjs"];
  const vivos = mortos.filter((f) => existsSync(path.join(RAIZ, "scripts", f)));
  if (vivos.length) throw new Error(`voltaram: ${vivos.join(", ")}`);
  return `${mortos.length} conferidos`;
});

/* ── a fiação ────────────────────────────────────────────────────────────── */

await etapa("nada importa `lib/espelho`", () => {
  /* Só o IMPORT é proibido. Citar o espelho em comentário é legítimo e
   * necessário — `planos.ts` precisa poder explicar por que o custo é
   * R$ 0,0459/GB, e a explicação é justamente "não há espelho". */
  const arquivos = [];
  const varrer = (dir) => {
    for (const item of readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
      const rel = `${dir}/${item.name}`;
      if (item.isDirectory()) varrer(rel);
      else if (/\.(ts|tsx|mjs)$/.test(item.name)) arquivos.push(rel);
    }
  };
  varrer("src");
  varrer("scripts");

  const culpados = arquivos.filter((rel) =>
    /from\s+["'][^"']*lib\/espelho(\.ts)?["']/.test(readFileSync(path.join(RAIZ, rel), "utf8")),
  );
  if (culpados.length) throw new Error(`ainda importam: ${culpados.join(", ")}`);
  return `${arquivos.length} arquivos varridos`;
});

await etapa("o ambiente carregado não tem credencial de espelho", () => {
  /* Confere o ambiente REAL — o mesmo `.env` que o app lê — e não o
   * `.env.local.example`, que nunca teve essas variáveis e por isso daria um
   * teste incapaz de falhar. Credencial de espelho parada num `.env` é chave
   * viva para um bucket que ninguém mais vigia. */
  const sobrou = Object.keys(process.env).filter((k) => k.startsWith("ESPELHO_"));
  if (sobrou.length) {
    throw new Error(`ainda no ambiente: ${sobrou.sort().join(", ")} — apague do .env`);
  }
});

/* ── o banco ─────────────────────────────────────────────────────────────── */

await etapa("as colunas de fila do espelho não existem em `medias`", async () => {
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_name = 'medias' and column_name in ('espelhado_em','espelho_frio_em')`,
  );
  if (rows.length) {
    throw new Error(
      `${rows.map((r) => r.column_name).join(", ")} ainda existe(m) — coluna que ninguém ` +
        `escreve é armadilha: quem ler "espelhado_em is null" conclui que há fila`,
    );
  }
});

await etapa("os índices parciais do espelho não existem", async () => {
  const { rows } = await db.query(
    `select indexname from pg_indexes
      where tablename = 'medias'
        and indexname in ('idx_medias_sem_espelho','idx_medias_sem_espelho_frio')`,
  );
  if (rows.length) throw new Error(`${rows.map((r) => r.indexname).join(", ")} ainda existe(m)`);
});

await db.end();

console.log(falhou ? "\n✗ sobrou espelho" : "\n✓ nenhum resto de espelho");
process.exitCode = falhou ? 1 : 0;
