#!/usr/bin/env node
/**
 * Testa o ESPAÇO USADO recontado por comando (migração 057). Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-uso-por-comando.mjs
 *
 * Juan, 01/10/2026: o "apagar de vez" de uma galeria de 2.204 arquivos ficava
 * em "Apagando…", e os botões do painel paravam de responder. O gatilho de uso
 * somava o estúdio inteiro UMA VEZ POR LINHA, com a linha do estúdio travada o
 * tempo todo. O que esta suíte prende:
 *
 *   - a conta continua EXATA em todo caminho que muda o que ela soma;
 *   - apagar milhares de linhas é rápido, e não cresce com o tamanho do estúdio.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

exigirBancoDeTeste();

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

/** O que está gravado contra o que a soma de verdade dá. */
async function conferir(tenantId, galerias) {
  const { rows: [t] } = await db.query(
    `select t.usado_bytes::bigint as gravado,
            coalesce((select sum(bytes) from medias where tenant_id = t.id and pronto), 0)::bigint as real
       from tenants t where t.id = $1`,
    [tenantId],
  );
  if (t.gravado !== t.real) throw new Error(`estúdio: gravado ${t.gravado}, real ${t.real}`);
  for (const g of galerias) {
    const { rows } = await db.query(
      `select g.bytes_total::bigint as gravado,
              coalesce((select sum(bytes) from medias where galeria_id = g.id and pronto), 0)::bigint as real
         from galerias g where g.id = $1`,
      [g],
    );
    if (rows.length && rows[0].gravado !== rows[0].real) {
      throw new Error(`galeria ${g}: gravado ${rows[0].gravado}, real ${rows[0].real}`);
    }
  }
  return t.real;
}

const inserir = (galeriaId, tenantId, n, bytes, pronto = true) =>
  db.query(
    `insert into medias (galeria_id, tenant_id, chave, nome_original, tipo, mime, bytes, ordem, pronto)
     select $1::uuid, $2::uuid, 'uso/' || gen_random_uuid(), 'X_' || i, 'foto', 'image/jpeg', $4::bigint, i, $5::boolean
       from generate_series(1, $3::int) i returning id`,
    [galeriaId, tenantId, n, bytes, pronto],
  );

console.log("O espaço usado, por comando\n");

try {
  const est = await estudioDaRodada(db);
  const a = await galeriaDaRodada(db, { nome: "uso-a", medias: 0 });
  const b = await galeriaDaRodada(db, { nome: "uso-b", medias: 0 });
  const gal = [a.id, b.id];

  await etapa("inserir em lote conta tudo, e o pendente não conta", async () => {
    await inserir(a.id, est.id, 500, 1000);
    await inserir(b.id, est.id, 300, 2000);
    await inserir(a.id, est.id, 7, 999_999, false);
    const total = await conferir(est.id, gal);
    if (total !== "1100000") throw new Error(`total ${total}`);
    return "1.100.000 bytes";
  });

  await etapa("confirmar o envio (pronto) entra na conta", async () => {
    await db.query("update medias set pronto = true where galeria_id = $1 and not pronto", [a.id]);
    await conferir(est.id, gal);
  });

  await etapa("republicar com outro tamanho muda a conta", async () => {
    await db.query("update medias set bytes = bytes + 5 where id in (select id from medias where galeria_id = $1 limit 10)", [b.id]);
    await conferir(est.id, gal);
  });

  await etapa("mover entre galerias recalcula as duas", async () => {
    await db.query("update medias set galeria_id = $2 where id in (select id from medias where galeria_id = $1 limit 50)", [a.id, b.id]);
    await conferir(est.id, gal);
  });

  await etapa("reordenar não mexe na conta", async () => {
    const { rows: [antes] } = await db.query("select atualizado_em from tenants where id = $1", [est.id]);
    await db.query("update medias set ordem = ordem + 1 where galeria_id = $1", [b.id]);
    const { rows: [depois] } = await db.query("select atualizado_em from tenants where id = $1", [est.id]);
    if (antes.atualizado_em.getTime() !== depois.atualizado_em.getTime()) {
      throw new Error("reordenar recontou o estúdio — trabalho à toa a cada arrasto");
    }
    await conferir(est.id, gal);
  });

  await etapa("apagar algumas fotos tira da conta", async () => {
    await db.query("delete from medias where id in (select id from medias where galeria_id = $1 limit 20)", [a.id]);
    await conferir(est.id, gal);
  });

  await etapa("apagar a galeria inteira (cascata) é rápido e tira tudo dela", async () => {
    await inserir(b.id, est.id, 5000, 3000);
    const t = performance.now();
    await db.query("delete from galerias where id = $1", [b.id]);
    const ms = performance.now() - t;
    await conferir(est.id, [a.id]);
    /* Com o gatilho por linha eram 5.000 somas do estúdio inteiro. */
    if (ms > 3000) throw new Error(`levou ${ms.toFixed(0)} ms`);
    return `${ms.toFixed(0)} ms para 5.300 arquivos`;
  });

  await etapa("só há os gatilhos por comando", async () => {
    const { rows } = await db.query(
      "select tgname from pg_trigger where tgrelid = 'medias'::regclass and not tgisinternal order by 1",
    );
    const nomes = rows.map((r) => r.tgname).join(",");
    if (nomes !== "trg_uso_delete,trg_uso_insert,trg_uso_update") throw new Error(nomes);
    return nomes;
  });
} finally {
  await limparRodada(db);
  await db.end();
}

console.log(falhou ? "\n✗ o espaço usado tem problema" : "\n✓ espaço usado por comando ok");
process.exit(falhou ? 1 : 0);
