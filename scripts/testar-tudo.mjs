#!/usr/bin/env node
/**
 * Roda a suíte inteira. Uso:
 *   npm test
 *
 * Antes eram 15 scripts soltos, cada um com sua linha de comando cheia de
 * flags — na prática ninguém rodava todos, e um teste que ninguém roda é um
 * teste que não existe.
 *
 * As que precisam do servidor de desenvolvimento no ar são marcadas: sem ele,
 * o resultado é "pulado" em vez de vermelho, para não confundir "não rodou"
 * com "quebrou".
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const AQUI = import.meta.dirname;
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

const suites = readdirSync(AQUI)
  .filter((f) => f.startsWith("testar-") && f.endsWith(".mjs") && f !== "testar-tudo.mjs")
  .map((f) => f.replace(/\.mjs$/, ""))
  .sort();

/**
 * Quais suítes batem em rotas HTTP — DEDUZIDO do próprio arquivo.
 *
 * Isto era uma lista escrita à mão, e a lista envelheceu: em 25/08/2026 nove
 * suítes usavam BASE_URL e só três estavam nela. O efeito é o pior possível num
 * arranjo de testes — com o servidor no ar, tudo verde; sem ele, três suítes
 * VERMELHAS por "fetch failed" e as outras seis puladas. A mesma ausência do
 * servidor produzia duas cores diferentes, e a vermelha acusava um problema que
 * não existia.
 *
 * Deduzir do conteúdo elimina a lista: suíte nova que fale HTTP entra sozinha, e
 * ninguém precisa lembrar de nada.
 */
const PRECISAM_DO_SERVIDOR = new Set(
  suites.filter((nome) => {
    const fonte = readFileSync(path.join(AQUI, `${nome}.mjs`), "utf8");
    return fonte.includes("BASE_URL") || fonte.includes("localhost:3040");
  }),
);

let servidorNoAr = false;
try {
  const r = await fetch(`${BASE}/api/healthz`, { signal: AbortSignal.timeout(5000) });
  servidorNoAr = r.ok;
} catch {
  servidorNoAr = false;
}

if (!servidorNoAr) {
  console.log(`⚠ servidor de desenvolvimento fora do ar (${BASE})`);
  console.log("  as suítes que dependem dele serão puladas — rode `npm run dev` para cobrir tudo\n");
}

const verdes = [];
const vermelhas = [];
const pulados = [];

for (const nome of suites) {
  if (PRECISAM_DO_SERVIDOR.has(nome) && !servidorNoAr) {
    pulados.push(nome);
    console.log(`  – ${nome} (pulado)`);
    continue;
  }

  const r = spawnSync(
    process.execPath,
    [
      "--env-file=.env.local",
      "--experimental-strip-types",
      "--import",
      "./scripts/registrar-ts.mjs",
      path.join("scripts", `${nome}.mjs`),
    ],
    { encoding: "utf8", cwd: path.resolve(AQUI, "..") },
  );

  const saida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status === 0) {
    verdes.push(nome);
    console.log(`  ✓ ${nome}`);
  } else {
    vermelhas.push(nome);
    console.log(`  ✗ ${nome}`);
    // Só as linhas de falha: despejar a saída inteira de 15 suítes esconderia
    // justamente o que interessa.
    for (const linha of saida.split("\n").filter((l) => l.includes("✗"))) {
      console.log(`      ${linha.trim()}`);
    }
  }
}

console.log(
  `\n${verdes.length} passaram · ${vermelhas.length} falharam${
    pulados.length ? ` · ${pulados.length} pulados` : ""
  }`,
);

if (vermelhas.length) {
  console.error(`\n✗ ${vermelhas.join(", ")}\n`);
  process.exit(1);
}
if (pulados.length) {
  console.log("\n⚠ cobertura parcial — suba o servidor e rode de novo antes de publicar\n");
  process.exit(0);
}
console.log("\n✓ suíte inteira verde\n");
