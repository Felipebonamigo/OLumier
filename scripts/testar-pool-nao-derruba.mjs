/*
 * ── O BANCO CAIR NÃO PODE MATAR O SERVIDOR (05/10/2026) ───────────────────
 *
 * Medido, não suposto: com o túnel do banco fora do ar, a home respondeu 500 e
 * o processo do Next morreu com
 *
 *     ⨯ uncaughtException: TypeError: object null is not iterable
 *         at AggregateError (<anonymous>)
 *         at consultar (src/lib/db.ts:48)
 *
 * O `fotosDaHome` TINHA tratamento e ele funcionou — o log "[home] fotos do
 * admin indisponíveis, usando as padrão" saiu antes do estouro. O que derrubou
 * veio de outro lugar: no node-postgres, erro numa conexão OCIOSA é emitido
 * como evento `error` no pool, fora de qualquer `await`. Pool sem ouvinte de
 * `error` vira `uncaughtException`, e `uncaughtException` encerra o processo.
 *
 * Nenhum `try/catch` em volta de uma consulta pega isso: na hora do evento não
 * há consulta nenhuma rodando. É por isso que o remendo certo é um ouvinte no
 * pool, e não mais um `catch` em quem consulta.
 *
 * O teste emite o evento em vez de derrubar o banco de verdade: o que precisa
 * ser provado é "pool com erro não encerra o processo", e derrubar o banco para
 * descobrir isso quebraria a bancada de quem mais estiver usando.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");

let vermelhas = 0;
function etapa(nome, fn) {
  try {
    const nota = fn();
    console.log(`  ✓ ${nome}${nota ? ` — ${nota}` : ""}`);
  } catch (e) {
    vermelhas++;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}

console.log("O banco cair não derruba o servidor:\n");

/** Roda um pedaço de código num processo só dele e devolve o que aconteceu. */
function numProcessoAparte(codigo, ambiente) {
  const r = spawnSync(
    process.execPath,
    [
      /* Com ambiente próprio o `.env.local` fica de fora: ele traria de volta
         o DATABASE_URL de verdade e o banco morto deixaria de estar morto. */
      ...(ambiente ? [] : ["--env-file=.env.local"]),
      "--conditions=react-server",
      "--experimental-strip-types",
      "--import",
      "./scripts/registrar-ts.mjs",
      "--input-type=module",
      "-e",
      codigo,
    ],
    { encoding: "utf8", cwd: RAIZ, env: { ...process.env, ...ambiente } },
  );
  return { codigo: r.status, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

etapa("o pool escuta os próprios erros", () => {
  const r = numProcessoAparte(`
    const { pool } = await import("./src/lib/db.ts");
    console.log("ouvintes:", pool().listenerCount("error"));
  `);
  const quantos = Number(/ouvintes: (\d+)/.exec(r.saida)?.[1] ?? 0);
  if (r.codigo !== 0) throw new Error(`o processo nem chegou lá: ${r.saida.trim().slice(0, 200)}`);
  if (quantos < 1) throw new Error("nenhum ouvinte de `error` no pool — um erro ocioso mata o processo");
  return `${quantos} ouvinte(s)`;
});

etapa("erro em conexão ociosa não encerra o processo", () => {
  /* É exatamente o que o node-postgres faz quando a conexão de uma conexão
     parada cai: emite `error` no pool, sem ninguém esperando por ele. */
  const r = numProcessoAparte(`
    const { pool } = await import("./src/lib/db.ts");
    const p = pool();
    p.emit("error", Object.assign(new Error("conexão caiu"), { code: "ECONNREFUSED" }), null);
    await new Promise((r) => setImmediate(r));
    console.log("sobrevivi");
    process.exit(0);
  `);
  if (!r.saida.includes("sobrevivi")) {
    throw new Error(`o processo morreu no evento: ${r.saida.trim().split("\n").slice(0, 3).join(" | ")}`);
  }
  if (r.codigo !== 0) throw new Error(`saiu com código ${r.codigo}`);
  return "o servidor continua de pé";
});

etapa("e o erro não some calado — fica no log", () => {
  const r = numProcessoAparte(`
    const { pool } = await import("./src/lib/db.ts");
    pool().emit("error", new Error("conexão caiu"), null);
    await new Promise((r) => setImmediate(r));
    process.exit(0);
  `);
  if (!/\[banco\]/.test(r.saida)) {
    throw new Error("o erro foi engolido: sem linha no log, uma queda de banco vira mistério");
  }
  return "registrado";
});

etapa("com o banco morto, a home ainda sai — com as fotos padrão", () => {
  /* ATENÇÃO ao que esta etapa prova e ao que NÃO prova: ela passa também com
     o ouvinte do pool desligado — medido. O que ela guarda é a promessa de
     `fotosDaHome` ("NUNCA LANÇA"), que já existia e continua valendo. Quem
     prende o ouvinte são as três etapas acima; esta prende a outra metade do
     contrato, que é a página sair mesmo assim. As duas precisam existir: sem
     esta, alguém "simplifica" o try/catch do fotosDaHome e a home volta a
     cair por um caminho que o ouvinte não cobre. */
  const r = numProcessoAparte(
    `
    const { fotosDaHome } = await import("./src/lib/fotos-da-home.ts");
    const { FOTOS_PADRAO } = await import("./src/config/home-demonstracao.ts");
    const saiu = await fotosDaHome();
    console.log("igual ao padrão:", JSON.stringify(saiu) === JSON.stringify(FOTOS_PADRAO));
    await new Promise((r) => setTimeout(r, 300));
    console.log("ainda de pé");
    process.exit(0);
  `,
    /* Porta onde não existe banco nenhum. */
    { DATABASE_URL: "postgres://ninguem@127.0.0.1:1/vazio" },
  );
  if (!r.saida.includes("ainda de pé")) {
    throw new Error(`o processo caiu: ${r.saida.trim().split("\n").slice(-3).join(" | ")}`);
  }
  if (!r.saida.includes("igual ao padrão: true")) {
    throw new Error("a home não caiu nas fotos padrão quando o banco sumiu");
  }
  return "fotos padrão";
});

if (vermelhas) {
  console.log(`\n✗ ${vermelhas} vermelha(s)\n`);
  process.exit(1);
}
console.log("\n✓ o banco cair não derruba o servidor\n");
