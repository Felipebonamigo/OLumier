#!/usr/bin/env node
/**
 * Prova que o cofre tem espaço PRÓPRIO. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-quota-cofre.mjs
 *
 * Antes de 20/08/2026 a home vendia "galeria + 500 GB de cofre" e isso não
 * existia no código: uma quota só somava tudo, e mandar galeria para o cofre não
 * liberava espaço nenhum. Os GB de cofre anunciados eram texto de vendas.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { usoDoEstudio } from "../src/lib/medias.ts";
import { arquivarAgora, reativar } from "../src/lib/cofre.ts";

exigirBancoDeTeste();

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
const igual = (a, b, oque) => {
  if (String(a) !== String(b)) throw new Error(`${oque}: esperava ${b}, veio ${a}`);
};

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const GB = 1024 ** 3;
let tenantId = null;
const criarEstudio = async (quotaAr, quotaCofre) => {
  const r = await db.query(
    `insert into tenants (slug,nome_estudio,email,senha_hash,quota_bytes,quota_cofre_bytes)
     values ($1,'Quota Cofre',$2,'x',$3,$4) returning id`,
    [`quota-cofre-${Date.now()}`, `qc-${Date.now()}@teste`, String(quotaAr), String(quotaCofre)],
  );
  return r.rows[0].id;
};
const criarGaleria = async (tid, bytes, estado = "online") => {
  const g = await db.query(
    `insert into galerias (tenant_id,slug,titulo,estado) values ($1,$2,'G',$3) returning id`,
    [tid, `g-${Math.random().toString(36).slice(2, 10)}`, estado],
  );
  await db.query(
    `insert into medias (galeria_id,tenant_id,chave,nome_original,tipo,mime,bytes,pronto)
     values ($1,$2,$3,'f.jpg','foto','image/jpeg',$4,true)`,
    [g.rows[0].id, tid, `qc/${g.rows[0].id}.jpg`, String(bytes)],
  );
  return g.rows[0].id;
};

console.log("\nOs dois baldes:\n");

try {
  // 100 GB no ar, 300 GB de cofre.
  tenantId = await criarEstudio(100 * GB, 300 * GB);

  await etapa("galeria no ar conta só no balde do ar", async () => {
    await criarGaleria(tenantId, 60 * GB);
    const u = await usoDoEstudio(tenantId);
    igual(u.noAr / BigInt(GB), 60, "no ar");
    igual(u.noCofre, 0, "no cofre");
    return "60 GB no ar, 0 no cofre";
  });

  let arquivavel = null;

  await etapa("arquivar move os bytes de balde e LIBERA espaço no ar", async () => {
    arquivavel = await criarGaleria(tenantId, 30 * GB);
    let u = await usoDoEstudio(tenantId);
    igual(u.noAr / BigInt(GB), 90, "antes de arquivar");

    const r = await arquivarAgora(arquivavel, tenantId);
    if (!r.ok) throw new Error(`recusou sem motivo: ${r.erro}`);

    u = await usoDoEstudio(tenantId);
    igual(u.noAr / BigInt(GB), 60, "no ar depois");
    igual(u.noCofre / BigInt(GB), 30, "no cofre depois");
    // Este é o ponto todo: 30 GB voltaram a caber nas galerias no ar.
    return "90 → 60 GB no ar, 30 GB no cofre";
  });

  await etapa("cofre cheio recusa arquivar, com recado que diz quanto falta", async () => {
    // Cofre com 300 GB, 30 já usados; uma galeria de 290 não cabe.
    const grande = await criarGaleria(tenantId, 290 * GB);
    const r = await arquivarAgora(grande, tenantId);
    igual(r.ok, false, "devia recusar");
    if (!/faltam .* GB/.test(r.erro ?? "")) throw new Error(`recado vago: ${r.erro}`);
    // E não pode ter arquivado mesmo assim.
    const { rows } = await db.query("select estado from galerias where id = $1", [grande]);
    igual(rows[0].estado, "online", "estado após recusa");
    await db.query("delete from galerias where id = $1", [grande]);
    return r.erro.slice(0, 52) + "…";
  });

  await etapa("reativar recusa quando não há espaço no ar", async () => {
    // Enche o ar: 60 usados de 100, uma de 35 deixa só 5 livres.
    const enche = await criarGaleria(tenantId, 35 * GB);
    const r = await reativar(arquivavel, tenantId);
    igual(r.ok, false, "devia recusar");
    if (!/faltam .* GB/.test(r.erro ?? "")) throw new Error(`recado vago: ${r.erro}`);
    const { rows } = await db.query("select estado from galerias where id = $1", [arquivavel]);
    igual(rows[0].estado, "arquivada", "continua no cofre");
    await db.query("delete from galerias where id = $1", [enche]);
    return "não traz de volta o que não cabe";
  });

  await etapa("com espaço, reativar traz de volta e devolve ao balde do ar", async () => {
    const r = await reativar(arquivavel, tenantId);
    if (!r.ok) throw new Error(`recusou sem motivo: ${r.erro}`);
    const u = await usoDoEstudio(tenantId);
    igual(u.noAr / BigInt(GB), 90, "no ar");
    igual(u.noCofre, 0, "no cofre");
    return "30 GB voltaram para o ar";
  });

  await etapa("o balde do ar ignora o que está no cofre", async () => {
    // O erro antigo: uma quota só. Aqui o cofre pode estar cheio que o envio
    // continua liberado enquanto houver espaço no ar.
    await criarGaleria(tenantId, 250 * GB, "arquivada");
    const u = await usoDoEstudio(tenantId);
    igual(u.noCofre / BigInt(GB), 250, "cofre carregado");
    igual(u.noAr / BigInt(GB), 90, "ar intocado");
    return "cofre com 250 GB não tira espaço do ar";
  });
} finally {
  if (tenantId) await db.query("delete from tenants where id = $1", [tenantId]);
  await db.end();
}

if (falhou) {
  console.error("\n✗ a quota do cofre tem problema\n");
  process.exit(1);
}
console.log("\n✓ cofre tem espaço próprio: arquivar libera o ar, e cada balde tem seu limite\n");
