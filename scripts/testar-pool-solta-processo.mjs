#!/usr/bin/env node
/**
 * O pool do app não pode segurar o processo depois que o trabalho acabou.
 * Uso: node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-pool-solta-processo.mjs
 *
 * ── O DEFEITO QUE ISTO PRENDE ─────────────────────────────────────────────
 *
 * Até 29/09/2026 o pool de `src/lib/db.ts` tinha só `idleTimeoutMillis: 30_000`.
 * Conexão ociosa mantém o event loop vivo, então todo script que consultava
 * pelo pool do app — e ~20 suítes fazem isso, via `src/lib` — terminava o
 * trabalho e ficava 30 s parado esperando as conexões expirarem.
 *
 * A suíte roda uma suíte depois da outra: eram ~10 dos ~16 min de cada
 * publicação, e o mesmo no Verificar. Em setembro isso levou a conta do GitHub
 * a 90% dos minutos de Actions do mês.
 *
 * O servidor em produção não depende do pool para ficar de pé — quem segura o
 * processo é o servidor HTTP — então soltar o processo ocioso não muda nada lá.
 *
 * Só leitura: a consulta é `select 1`.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");

// Folga larga para o tempo de subir o node e conectar; o defeito custa 30 s.
const LIMITE_MS = 10_000;

const filho = `
  const { consultar } = await import("./src/lib/db.ts");
  await consultar("select 1");
`;

const inicio = Date.now();
const r = spawnSync(
  process.execPath,
  [
    "--conditions=react-server",
    "--experimental-strip-types",
    "--import",
    "./scripts/registrar-ts.mjs",
    "--input-type=module",
    "-e",
    filho,
  ],
  { cwd: RAIZ, encoding: "utf8", env: process.env, timeout: 60_000 },
);
const ms = Date.now() - inicio;

console.log("pool do app: o processo termina quando o trabalho termina");
if (r.status !== 0) {
  console.log(`  ✗ o processo filho falhou (status ${r.status}):\n${r.stderr}`);
  process.exitCode = 1;
} else if (ms > LIMITE_MS) {
  console.log(
    `  ✗ o processo levou ${ms} ms para sair depois de uma consulta — ` +
      `o pool está segurando o event loop com conexão ociosa (limite ${LIMITE_MS} ms)`,
  );
  process.exitCode = 1;
} else {
  console.log(`  ✓ saiu em ${ms} ms`);
}
