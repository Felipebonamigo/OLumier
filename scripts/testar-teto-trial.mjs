#!/usr/bin/env node
/**
 * O teto de espaço do período de teste. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-teto-trial.mjs
 *
 * ── O BURACO QUE ISTO FECHA ───────────────────────────────────────────────
 *
 * O cadastro grava `quota_bytes` do PLANO ESCOLHIDO, e o trial nasce sem
 * cartão. Quem escolhesse 10 TB no cadastro ganhava 10 TB de quota por 14 dias
 * sem pagar nada — e 10 TB cheios custam R$ 458,73/mês de B2+R2, pela nossa
 * própria planilha (`custoArmazenamentoCentavos`). O prejuízo não acabava com
 * o trial: vencido, o envio trava mas os bytes ficam guardados, custando.
 *
 * A regra: enquanto `status = 'trial'`, a quota EFETIVA é
 * `min(quota do plano, TETO_TRIAL)`. É regra, não estado — nada é gravado, e
 * no dia em que o pagamento confirmar (`status = 'ativo'`) o teto some
 * sozinho, sem webhook precisar reescrever quota.
 *
 * 10 GB de teto porque ainda cabe um casamento inteiro de FOTOS (4 a 6 GB numa
 * cobertura típica), então o produto se prova no uso real, e limita o pior caso
 * a ~R$ 0,46/mês por trial abandonado. Era 25 GB até 27/08/2026.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import { quotaEfetivaBytes, TETO_TRIAL_BYTES, TETO_TRIAL_GB } from "../src/config/trial.ts";
import { readFileSync } from "node:fs";
import path from "node:path";

exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
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

const GB = 1024n ** 3n;

console.log("O teto do trial:\n");

/* ── a regra, sozinha ────────────────────────────────────────────────────── */

await etapa("o teto vale 10 GB", () => {
  /* O número É a política, não detalhe de implementação: prendê-lo obriga quem
   * for mudar a olhar o custo e o recado da tela junto. Era 25 GB até
   * 27/08/2026. */
  if (TETO_TRIAL_GB !== 10) throw new Error(`o teto está em ${TETO_TRIAL_GB} GB`);
});

await etapa("trial com plano de 10 TB fica com o teto", () => {
  const q = quotaEfetivaBytes({ status: "trial", quota_bytes: String(10240n * GB) });
  if (q !== TETO_TRIAL_BYTES) throw new Error(`veio ${q}, esperava o teto ${TETO_TRIAL_BYTES}`);
  return "10 TB de plano → teto no trial";
});

await etapa("ativo com o mesmo plano usa a quota inteira", () => {
  const cheia = 10240n * GB;
  const q = quotaEfetivaBytes({ status: "ativo", quota_bytes: String(cheia) });
  if (q !== cheia) throw new Error("pagou e ficou com o teto — o teto virou castigo");
  return "pagou, teto some sozinho";
});

await etapa("teto é TETO, não piso: plano menor que ele fica como está", () => {
  const pequena = 5n * GB;
  const q = quotaEfetivaBytes({ status: "trial", quota_bytes: String(pequena) });
  if (q !== pequena) throw new Error(`plano de 5 GB virou ${q} no trial`);
  return "5 GB continua 5 GB";
});

await etapa("status desconhecido NÃO ganha o teto", () => {
  /* O teto é a régua do trial. Aplicá-lo a um status que ninguém previu
   * derrubaria quem está pagando por causa de um estado novo — a mesma regra
   * do portão de cobrança: na dúvida, não trava quem paga. */
  const cheia = 1024n * GB;
  const q = quotaEfetivaBytes({ status: "seja-la-o-que-for", quota_bytes: String(cheia) });
  if (q !== cheia) throw new Error("status desconhecido foi tratado como trial");
});

/* ── a fiação: as rotas usam a regra, não a coluna crua ──────────────────── */

await etapa("as quatro rotas de envio passam pela quota EFETIVA", () => {
  const rotas = [
    "src/app/api/galerias/[id]/upload/route.ts",
    "src/app/api/medias/[id]/arquivo/route.ts",
    "src/app/api/medias/[id]/confirmar/route.ts",
    "src/app/api/medias/[id]/partes/route.ts",
  ];
  const furadas = rotas.filter((r) => {
    const fonte = readFileSync(path.join(RAIZ, r), "utf8");
    /* O padrão perigoso é COMPARAR consumo contra a coluna crua
     * (`> BigInt(tenant.quota_bytes)`). Ler o valor cru para outra coisa é
     * legítimo — a própria rota de upload o lê para saber se a recusa veio do
     * teto e escolher o recado. */
    return !fonte.includes("quotaEfetivaBytes") || />\s*BigInt\(tenant\.quota_bytes\)/.test(fonte);
  });
  if (furadas.length) {
    throw new Error(
      `${furadas.join(", ")} ainda lê quota_bytes cru — o teto existe e não protege nada`,
    );
  }
  return "4 rotas na regra";
});

/* ── de ponta a ponta: a rota recusa de verdade ──────────────────────────── */

const marca = `teto-${Date.now()}`;
const { rows: [estudio] } = await db.query(
  `insert into tenants (slug, nome_estudio, email, senha_hash, quota_bytes)
   values ($1, 'Estúdio Teto', $2, 'x', $3) returning id, status`,
  [marca, `${marca}@teste`, String(1024n * GB)],
);
const { rows: [galeria] } = await db.query(
  `insert into galerias (tenant_id, slug, titulo) values ($1, 'teto', 'Teto') returning id`,
  [estudio.id],
);
const cookie = cookieDeSessao(estudio.id);
const declarar = (bytes) =>
  fetch(`${BASE}/api/galerias/${galeria.id}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ nome: "filme.mp4", mime: "video/mp4", bytes: Number(bytes) }),
  });

try {
  await etapa("nasce como trial, com quota de plano grande", async () => {
    if (estudio.status !== "trial") throw new Error(`status ${estudio.status} — o default mudou?`);
    return "1 TB de plano, status trial";
  });

  await etapa("trial declarando 11 GB é recusado com o motivo certo", async () => {
    const r = await declarar(11n * GB);
    if (r.status !== 507) throw new Error(`esperava 507, veio ${r.status}`);
    const corpo = await r.json().catch(() => ({}));
    const texto = JSON.stringify(corpo);
    if (!/teste|trial/i.test(texto)) {
      throw new Error(
        `recusou sem dizer que é o limite do período de teste: ${texto.slice(0, 120)} — ` +
          `quem lê "espaço cheio" com 1 TB contratado acha que o produto quebrou`,
      );
    }
    return "HTTP 507, citando o período de teste";
  });

  await etapa("o mesmo estúdio, DEPOIS de pagar, envia os 11 GB", async () => {
    await db.query(`update tenants set status = 'ativo' where id = $1`, [estudio.id]);
    const r = await declarar(11n * GB);
    if (!r.ok) throw new Error(`pagou e continuou preso no teto: HTTP ${r.status}`);
    return "mesma declaração passa";
  });
} finally {
  await db.query(`delete from tenants where id = $1`, [estudio.id]);
  await db.end();
}

console.log(falhou ? "\n✗ o teto do trial tem problema" : "\n✓ teto do trial ok");
process.exitCode = falhou ? 1 : 0;
