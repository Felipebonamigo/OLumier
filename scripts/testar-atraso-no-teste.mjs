#!/usr/bin/env node
/**
 * QUEM VIROU INADIMPLENTE COM O TESTE AINDA VALENDO — a migração 065. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-atraso-no-teste.mjs
 *
 * O aviso de "cobrança vencida" do Asaas marcava `inadimplente` sem olhar o
 * teste (corrigido em `api/asaas/webhook`, e provado por `testar-cobranca`).
 * Esta suíte prova a OUTRA metade: que a migração que desfaz o estrago pega
 * exatamente quem tem de pegar — a conta que nunca pagou e ainda tem teste — e
 * mais ninguém. Corrigir dado de produção é o tipo de UPDATE em que "pegou
 * gente demais" custa mais que "deixou passar".
 *
 * Roda o SQL do próprio arquivo da migração, e não uma cópia dele: a cópia
 * envelhece sozinha.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { marcaDaRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

const SQL = readFileSync(path.resolve(import.meta.dirname, "../db/migracoes/064-atraso-no-teste.sql"), "utf8");
const MARCA = marcaDaRodada();
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
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const criados = [];
let n = 0;
async function conta({ status, trialAte, pagoAte = null }) {
  n++;
  const { rows } = await db.query(
    `insert into tenants (slug, nome_estudio, email, senha_hash, quota_bytes, status, trial_ate, pago_ate)
     values ($1, $2, $3, 'x', $4, $5, $6, $7) returning id`,
    [`atraso-${MARCA}-${n}`, `Atraso ${n}`, `${MARCA}-atraso-${n}@teste.local`, String(10 * 1024 ** 3), status, trialAte, pagoAte],
  );
  criados.push(rows[0].id);
  return rows[0].id;
}
const status = async (id) => (await db.query("select status from tenants where id = $1", [id])).rows[0].status;
const DIA = 24 * 60 * 60 * 1000;

try {
  console.log("A migração 065:\n");

  const errada = await conta({ status: "inadimplente", trialAte: new Date(Date.now() + 5 * DIA) });
  const teste_vencido = await conta({ status: "inadimplente", trialAte: new Date(Date.now() - 2 * DIA) });
  const ja_pagou = await conta({
    status: "inadimplente",
    trialAte: new Date(Date.now() + 5 * DIA),
    pagoAte: new Date(Date.now() - DIA),
  });
  const em_teste = await conta({ status: "trial", trialAte: new Date(Date.now() + 5 * DIA) });
  const cortesia = await conta({ status: "cortesia", trialAte: new Date(Date.now() + 5 * DIA) });
  const cancelada = await conta({ status: "cancelado", trialAte: new Date(Date.now() + 5 * DIA) });

  await etapa("volta para teste só quem nunca pagou e ainda tem teste", async () => {
    await db.query(SQL);
    igual(await status(errada), "trial", "a conta do defeito");
  });

  await etapa("não toca em quem tem o teste vencido, quem já pagou, nem em outros status", async () => {
    igual(await status(teste_vencido), "inadimplente", "teste vencido");
    igual(await status(ja_pagou), "inadimplente", "já pagou");
    igual(await status(em_teste), "trial", "em teste");
    igual(await status(cortesia), "cortesia", "cortesia");
    igual(await status(cancelada), "cancelado", "cancelada");
  });

  await etapa("deixa um evento no registro, com o motivo", async () => {
    const { rows } = await db.query(
      "select detalhe from eventos where tenant_id = $1 and acao = 'conta.status_corrigido'",
      [errada],
    );
    igual(rows.length, 1, "eventos");
    igual(rows[0].detalhe.motivo, "atraso_durante_o_teste", "motivo");
    igual(rows[0].detalhe.de + ">" + rows[0].detalhe.para, "inadimplente>trial", "de e para");
  });

  await etapa("é idempotente: rodar de novo não acha ninguém e não repete o evento", async () => {
    await db.query(SQL);
    const { rows } = await db.query("select count(*)::int as n from eventos where tenant_id = $1 and acao = 'conta.status_corrigido'", [errada]);
    igual(rows[0].n, 1, "eventos depois da segunda rodada");
  });
} finally {
  if (criados.length) await db.query("delete from tenants where id = any($1)", [criados]);
  await db.end();
}

if (falhou) {
  console.log("\n✗ a migração 065 pega a conta errada");
  process.exit(1);
}
console.log("\n✓ migração 065: só quem tem de ser corrigido");
