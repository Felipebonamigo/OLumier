#!/usr/bin/env node
/**
 * Alinha as quotas de cada estúdio com o plano dele.
 *
 *   node --env-file=.env.production --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/sincronizar-quotas.mjs [--aplicar]
 *
 * Existe porque `src/config/planos.ts` é a fonte da verdade comercial, e o banco
 * guarda os números em bytes. Quando um plano muda de tamanho (ou nasce um novo
 * campo, como o cofre da migração 007), as contas já criadas ficam para trás.
 *
 * Repetir os valores numa migração SQL criaria uma segunda fonte da verdade que
 * envelheceria calada na primeira mudança de preço — por isso a sincronia lê o
 * TypeScript.
 *
 * SEM `--aplicar` só mostra o que mudaria.
 */
import pg from "pg";
import { planoPorId, GB } from "../src/config/planos.ts";

const APLICAR = process.argv.includes("--aplicar");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  const { rows } = await db.query(
    "select id, nome_estudio, plano_id, quota_bytes, quota_cofre_bytes from tenants order by criado_em",
  );

  if (rows.length === 0) {
    console.log("nenhum estúdio cadastrado");
    process.exit(0);
  }

  const emGB = (b) => (Number(b) / GB).toFixed(0) + " GB";
  let mudariam = 0;

  for (const t of rows) {
    const plano = planoPorId(t.plano_id);
    if (!plano) {
      // Não inventar quota para plano que não existe mais: mexer aqui poderia
      // reduzir o espaço de alguém sem querer.
      console.log(`  ! ${t.nome_estudio}: plano "${t.plano_id}" não existe em planos.ts — pulado`);
      continue;
    }

    const alvoAr = BigInt(plano.quotaGb) * BigInt(GB);
    const alvoCofre = BigInt(plano.cofreGb) * BigInt(GB);
    const atualAr = BigInt(t.quota_bytes);
    const atualCofre = BigInt(t.quota_cofre_bytes);

    if (alvoAr === atualAr && alvoCofre === atualCofre) continue;

    mudariam++;
    console.log(`  ${t.nome_estudio} (${plano.nome})`);
    if (alvoAr !== atualAr) console.log(`      no ar: ${emGB(atualAr)} → ${emGB(alvoAr)}`);
    if (alvoCofre !== atualCofre) {
      console.log(`      cofre: ${emGB(atualCofre)} → ${emGB(alvoCofre)}`);
    }

    if (APLICAR) {
      await db.query(
        "update tenants set quota_bytes = $1, quota_cofre_bytes = $2, atualizado_em = now() where id = $3",
        [alvoAr.toString(), alvoCofre.toString(), t.id],
      );
    }
  }

  if (mudariam === 0) {
    console.log(`✓ ${rows.length} estúdio(s) já em dia com os planos`);
  } else if (APLICAR) {
    console.log(`\n✓ ${mudariam} estúdio(s) atualizados`);
  } else {
    console.log(`\n${mudariam} estúdio(s) mudariam. Rode com --aplicar para valer.`);
  }
} finally {
  await db.end();
}
