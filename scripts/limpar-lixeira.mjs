#!/usr/bin/env node
/**
 * Destrói de vez o que passou do prazo na lixeira.
 *
 *   ... scripts/limpar-lixeira.mjs              → mostra o que venceu (não apaga)
 *   ... scripts/limpar-lixeira.mjs --aplicar    → apaga
 *
 * Roda pelo temporizador do servidor, de madrugada. É o único lugar do sistema
 * que apaga arquivo de galeria de verdade — apagar no painel só move para a
 * lixeira.
 *
 * Aqui havia a ressalva de que o ESPELHO não era tocado, porque a segunda cópia
 * era o que sobrava quando tudo mais falhava. O espelho foi removido em
 * 27/08/2026 (ver `scripts/testar-sem-espelho.mjs`), então esta limpeza apaga a
 * única cópia existente. O prazo da lixeira é o que separa o engano do
 * definitivo — e é a última rede que sobrou.
 */
import pg from "pg";
import { galeriasVencidasNaLixeira, destruirGaleria, PRAZO_LIXEIRA_DIAS } from "../src/lib/tenants.ts";

const APLICAR = process.argv.includes("--aplicar");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  /* Os pedidos de ZIP vencem em 12 h (migração 039) e não têm outro faxineiro.
     As entregas registradas ficam: a FK põe null no pedido, e os bytes seguem
     somando no painel. Corre sempre, mesmo sem --aplicar: é lixo, não galeria. */
  const { rowCount: pedidos } = await db.query(`delete from pedidos_zip where expira_em < now()`);
  if (pedidos) console.log(`pedidos de zip vencidos apagados: ${pedidos}`);

  const { rows: resumo } = await db.query(
    `select count(*)::int as na_lixeira,
            count(*) filter (where apagada_em < now() - ($1 || ' days')::interval)::int as vencidas
       from galerias where estado = 'lixeira'`,
    [PRAZO_LIXEIRA_DIAS],
  );
  console.log(`na lixeira: ${resumo[0].na_lixeira} · vencidas: ${resumo[0].vencidas}`);

  const vencidas = await galeriasVencidasNaLixeira();
  if (vencidas.length === 0) {
    console.log("✓ nada a destruir");
    process.exit(0);
  }

  for (const g of vencidas) {
    console.log(`  ${g.titulo} — ${g.chaves.length} arquivo(s)`);
  }

  if (!APLICAR) {
    console.log(`\nNada foi apagado. Para apagar: --aplicar`);
    process.exit(0);
  }

  let destruidas = 0;
  for (const g of vencidas) {
    await destruirGaleria(g.id, g.chaves);
    destruidas++;
  }
  console.log(`\n✓ ${destruidas} galeria(s) destruída(s) depois de ${PRAZO_LIXEIRA_DIAS} dias`);
} finally {
  await db.end();
}
