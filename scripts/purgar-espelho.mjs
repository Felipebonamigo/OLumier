#!/usr/bin/env node
/**
 * Limpa o espelho.
 *
 *   ... scripts/purgar-espelho.mjs                    → o que sobrou de galeria
 *                                                        já destruída (não apaga)
 *   ... scripts/purgar-espelho.mjs --aplicar
 *   ... scripts/purgar-espelho.mjs --estudio=<slug> --exclusao --aplicar
 *   ... scripts/purgar-espelho.mjs --galeria=<uuid> --exclusao --aplicar
 *
 * DOIS MODOS, e a diferença entre eles é a coisa mais importante deste arquivo:
 *
 *   varredura (padrão) — apaga só o que NÃO tem mais linha no banco. É a
 *     faxina do dia a dia: galeria destruída depois dos 30 dias na lixeira
 *     deixa a cópia para trás, e ela continua sendo paga todo mês.
 *
 *   --exclusao — apaga TAMBÉM o que ainda existe. Serve a um pedido de
 *     exclusão da LGPD, quando o titular quer o dado fora agora. É a única
 *     operação do sistema capaz de destruir a segunda cópia de um arquivo vivo,
 *     e por isso exige a palavra escrita na linha de comando: nenhuma rotina
 *     automática a usa.
 */
import pg from "pg";
import { espelhoConfigurado, purgarEspelho } from "../src/lib/espelho.ts";

const arg = (n) => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`));
  return a ? a.split("=").slice(1).join("=") : null;
};
const APLICAR = process.argv.includes("--aplicar");
const EXCLUSAO = process.argv.includes("--exclusao");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}
if (!espelhoConfigurado) {
  console.error("✗ espelho não configurado — ver docs/backup.md");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  let tenantId = null;
  const estudio = arg("estudio");
  if (estudio) {
    const { rows } = await db.query("select id, nome_estudio from tenants where slug = $1", [
      estudio,
    ]);
    if (rows.length === 0) {
      console.error(`✗ não achei estúdio com slug "${estudio}"`);
      process.exit(1);
    }
    tenantId = rows[0].id;
    console.log(`estúdio: ${rows[0].nome_estudio}`);
  }

  const galeriaId = arg("galeria");
  if (galeriaId && !tenantId) {
    // Precisa do tenant para montar o prefixo — a chave começa por ele.
    const { rows } = await db.query("select tenant_id from galerias where id = $1", [galeriaId]);
    if (rows.length === 0) {
      console.error(`✗ galeria ${galeriaId} não existe mais no banco.`);
      console.error("  Para exclusão de galeria já destruída, use --estudio=<slug>.");
      process.exit(1);
    }
    tenantId = rows[0].tenant_id;
  }

  if (EXCLUSAO && !tenantId) {
    console.error("✗ --exclusao exige --estudio= ou --galeria=.");
    console.error("  Apagar a cópia viva do espelho INTEIRO nunca é o que se quer.");
    process.exit(1);
  }

  if (EXCLUSAO) {
    console.log("⚠ MODO EXCLUSÃO: apaga também o que ainda tem linha no banco.");
  }

  const r = await purgarEspelho({
    tenantId: tenantId ?? undefined,
    galeriaId: galeriaId ?? undefined,
    exclusaoSolicitada: EXCLUSAO,
    aplicar: APLICAR,
  });

  console.log(`órfãs encontradas: ${r.orfas.length}`);
  for (const c of r.orfas.slice(0, 10)) console.log(`  · ${c}`);
  if (r.orfas.length > 10) console.log(`  … e mais ${r.orfas.length - 10}`);

  if (!APLICAR) {
    console.log("\nNada foi apagado. Para apagar: --aplicar");
    process.exit(0);
  }

  console.log(`\n✓ ${r.apagadas} objeto(s) apagado(s) do espelho`);

  if (r.erros.length > 0) {
    /*
     * O motivo mais comum aqui não é bug: é o Object Lock recusando objeto que
     * ainda está dentro dos 30 dias de retenção. A trava funcionando é a
     * resposta certa — quem pediu a exclusão precisa saber que ela só se
     * completa depois do prazo.
     */
    console.error(`\n⚠ ${r.erros.length} não pôde(ram) ser apagado(s):`);
    for (const e of r.erros.slice(0, 5)) console.error(`    ${e}`);
    console.error("\n  Se for Object Lock: o objeto sai sozinho quando a retenção vencer.");
    process.exit(1);
  }
} finally {
  await db.end();
}
