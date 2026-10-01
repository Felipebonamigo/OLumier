#!/usr/bin/env node
/**
 * A DATA DO EVENTO É UM DIA, NÃO UM INSTANTE. Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-data-do-evento.mjs
 *
 * Precisa do banco; a última etapa, do servidor de desenvolvimento.
 *
 * ── O DEFEITO (30/09/2026) ────────────────────────────────────────────────
 *
 * Julia Flores: "se eu quero dia 26 ele aparece na capa dia 25 (aí para
 * aparecer dia 26 eu tenho que colocar que foi dia 27)".
 *
 * `data_evento` é `date` no banco — dia puro. O driver do Postgres entregava
 * meia-noite NO FUSO DO PROCESSO, e o VPS roda em UTC: 26/09 00:00 UTC. Na
 * véspera (29/09), toda data da tela passou a ser mostrada em Brasília
 * (`config/fuso.ts`) — certo para instante, errado para dia: 00:00 UTC é
 * 21:00 do dia 25 em Brasília. A capa dizia 25.
 *
 * Na máquina de quem desenvolve (em Brasília) o defeito não aparece: lá a
 * meia-noite é local, e continua dia 26 em Brasília. Por isso esta suíte roda
 * as contas com o processo em UTC, em Brasília e em Tóquio.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";

exigirBancoDeTeste();

const { consultar } = await import("../src/lib/db.ts");
const { paraCampoDeData } = await import("../src/lib/datas.ts");
const { FUSO } = await import("../src/config/fuso.ts");

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

const naTela = (d) =>
  new Date(d).toLocaleDateString("pt-BR", { timeZone: FUSO, day: "2-digit", month: "long", year: "numeric" });

const DIAS = ["2026-09-26", "2026-01-01", "2026-12-31", "2027-02-28"];
const FUSOS_DO_PROCESSO = ["UTC", "America/Sao_Paulo", "Asia/Tokyo"];

console.log("A data do evento\n");

for (const tz of FUSOS_DO_PROCESSO) {
  await etapa(`com o servidor em ${tz}, o dia gravado é o dia mostrado`, async () => {
    const antes = process.env.TZ;
    process.env.TZ = tz;
    try {
      const erros = [];
      for (const dia of DIAS) {
        const [{ d }] = await consultar("select $1::date as d", [dia]);
        const [ano, mes, diaDoMes] = dia.split("-").map(Number);
        const esperado = new Date(Date.UTC(ano, mes - 1, diaDoMes, 12)).toLocaleDateString("pt-BR", {
          timeZone: "UTC",
          day: "2-digit",
          month: "long",
          year: "numeric",
        });
        if (naTela(d) !== esperado) erros.push(`${dia} → "${naTela(d)}"`);
        if (paraCampoDeData(new Date(d)) !== dia) erros.push(`${dia} no formulário → ${paraCampoDeData(new Date(d))}`);
      }
      if (erros.length) throw new Error(erros.join("; "));
      return `${DIAS.length} dias, na tela e no formulário`;
    } finally {
      process.env.TZ = antes;
    }
  });
}

/* ── A capa, de verdade ─────────────────────────────────────────────────── */
const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { galeriaDaRodada, limparRodada } = await import("./fixture-de-teste.mjs");
try {
  await etapa("a capa da galeria pública mostra 26 de setembro para o dia 26", async () => {
    const g = await galeriaDaRodada(db, { nome: "data-do-evento", medias: 1 });
    await db.query("update galerias set data_evento = '2026-09-26' where id = $1", [g.id]);
    const r = await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`);
    const html = await r.text();
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    if (html.includes("25 de setembro de 2026")) throw new Error('a capa diz "25 de setembro de 2026"');
    if (!html.includes("26 de setembro de 2026")) throw new Error('a capa não diz "26 de setembro de 2026"');
    return "26 de setembro de 2026";
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ a data do evento anda de dia" : "\n✓ o dia do evento é o dia que o fotógrafo escolheu");
process.exitCode = falhou ? 1 : 0;
