#!/usr/bin/env node
/**
 * Lê o log de auditoria.
 *
 *   ... scripts/auditoria.mjs                          → os 50 últimos eventos
 *   ... scripts/auditoria.mjs --estudio=sirius         → tudo de um estúdio
 *   ... scripts/auditoria.mjs --alvo=<uuid da galeria> → tudo sobre uma galeria
 *   ... scripts/auditoria.mjs --desde=2026-08-01 --ate=2026-08-31
 *   ... scripts/auditoria.mjs --acao=galeria.apagada
 *
 * Existe porque log que ninguém consegue ler não serve de prova. A pergunta de
 * uma disputa é sempre a mesma — "o que aconteceu com a galeria X?" — e ela é
 * feita quando a galeria X já não existe. Por isso `--alvo` busca por id solto,
 * sem depender de a linha original ainda estar no banco.
 */
import pg from "pg";

const arg = (nome) => {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a ? a.split("=").slice(1).join("=") : null;
};

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  const onde = [];
  const vals = [];

  const estudio = arg("estudio");
  if (estudio) {
    vals.push(`%${estudio}%`);
    // Casa pelo nome copiado no evento OU pelo slug atual da conta: o nome pode
    // ter mudado depois, e a conta pode nem existir mais.
    onde.push(`(e.estudio ilike $${vals.length}
                or e.tenant_id in (select id from tenants where slug ilike $${vals.length}))`);
  }

  const alvo = arg("alvo");
  if (alvo) {
    vals.push(alvo);
    onde.push(`e.alvo_id = $${vals.length}`);
  }

  const acao = arg("acao");
  if (acao) {
    vals.push(`${acao}%`);
    onde.push(`e.acao like $${vals.length}`);
  }

  const desde = arg("desde");
  if (desde) {
    vals.push(desde);
    onde.push(`e.criado_em >= $${vals.length}::date`);
  }

  const ate = arg("ate");
  if (ate) {
    vals.push(ate);
    // +1 dia para o filtro incluir o dia inteiro, e não parar à meia-noite.
    onde.push(`e.criado_em < ($${vals.length}::date + interval '1 day')`);
  }

  const limite = Number(arg("limite") ?? (alvo || estudio ? 500 : 50));

  const { rows } = await db.query(
    `select e.criado_em, e.ator, e.acao, e.alvo_tipo, e.alvo_id, e.detalhe,
            coalesce(e.estudio, '—') as estudio
       from eventos e
      ${onde.length ? `where ${onde.join(" and ")}` : ""}
      order by e.id desc
      limit ${limite}`,
    vals,
  );

  if (rows.length === 0) {
    console.log("nenhum evento com esses filtros");
    process.exit(0);
  }

  console.log(`${rows.length} evento(s)\n`);
  for (const r of rows) {
    const quando = new Date(r.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const det = Object.entries(r.detalhe ?? {})
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join(" · ");
    console.log(`${quando}  [${r.ator}]  ${r.acao}`);
    console.log(`    estúdio: ${r.estudio}${r.alvo_id ? `  alvo: ${r.alvo_id}` : ""}`);
    if (det) console.log(`    ${det}`);
  }
  console.log("\nHorários em America/Sao_Paulo. O banco guarda em UTC.");
} finally {
  await db.end();
}
