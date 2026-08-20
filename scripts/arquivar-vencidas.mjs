#!/usr/bin/env node
/**
 * Manda para o cofre as galerias que venceram. Roda todo dia no servidor
 * (temporizador do systemd). Uso manual:
 *   node --env-file=.env.production scripts/arquivar-vencidas.mjs
 *
 * Só muda o estado — nenhum arquivo é apagado. A galeria sai do ar e volta em um
 * clique pelo painel.
 */
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definida");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  const { rows } = await db.query(
    `update galerias g
        set estado = 'arquivada', arquivada_em = now(), atualizado_em = now()
       from tenants t
      where t.id = g.tenant_id
        and g.estado = 'online'
        and g.expira_em is not null
        and g.expira_em < now()
      returning g.titulo, t.nome_estudio`,
  );

  const quando = new Date().toISOString();
  if (rows.length === 0) {
    // Registra mesmo sem trabalho: log silencioso esconde tarefa que parou de rodar.
    console.log(`${quando} nenhuma galeria venceu`);
  } else {
    console.log(`${quando} ${rows.length} galeria(s) para o cofre:`);
    for (const r of rows) console.log(`  - ${r.nome_estudio}: ${r.titulo}`);
  }

  /*
   * O arquivamento por prazo NÃO recusa por falta de espaço no cofre — o prazo
   * foi combinado com o casal, e segurar a galeria no ar quebraria o combinado E
   * continuaria consumindo a quota das galerias no ar. Mas passar do contratado
   * em silêncio seria pior ainda: aqui é onde isso vira visível.
   */
  const { rows: acima } = await db.query(
    `select t.nome_estudio, t.email,
            coalesce(sum(m.bytes),0)::text as usado,
            t.quota_cofre_bytes::text      as limite
       from tenants t
       join galerias g on g.tenant_id = t.id and g.estado = 'arquivada'
       join medias   m on m.galeria_id = g.id
      group by t.id, t.nome_estudio, t.email, t.quota_cofre_bytes
     having coalesce(sum(m.bytes),0) > t.quota_cofre_bytes`,
  );

  if (acima.length > 0) {
    const gb = (b) => (Number(b) / 1024 ** 3).toFixed(1);
    console.log(`${quando} ⚠ ${acima.length} estúdio(s) acima do cofre contratado:`);
    for (const a of acima) {
      console.log(`  ! ${a.nome_estudio} (${a.email}): ${gb(a.usado)} GB de ${gb(a.limite)} GB`);
    }
  }
} catch (e) {
  console.error(`${new Date().toISOString()} FALHOU: ${e.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
