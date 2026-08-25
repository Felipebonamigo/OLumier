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
 * NÃO toca no espelho. A segunda cópia é justamente o que sobra quando tudo
 * mais falhou; apagá-la aqui transformaria esta limpeza no risco que ela
 * deveria cobrir. O que o espelho acumula de galeria destruída é recolhido pelo
 * `varrer-orfaos.mjs`, à mão e com conferência.
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
