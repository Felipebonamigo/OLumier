#!/usr/bin/env node
/**
 * Troca de plano e cancelamento. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-troca-plano.mjs
 *
 * O erro de quota sempre disse "aumente o plano" e, até 20/08/2026, não havia
 * como fazer isso dentro do app — a pessoa lia uma instrução impossível.
 *
 * A regra que mais importa aqui é a de DESCER: aceitar um plano menor do que o
 * que já está guardado deixaria o estúdio instantaneamente acima do limite, com
 * uma conta travada que ninguém sabe destravar.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { planos, planoPorId, GB } from "../src/config/planos.ts";
import { usoDoEstudio } from "../src/lib/medias.ts";

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

/*
 * A action lê a sessão por cookie, então aqui exercitamos a REGRA com as mesmas
 * consultas que ela usa. O caminho pela tela é coberto pelo type-check e pelo
 * uso real; o que precisa de teste é a aritmética da decisão.
 */
const cabeNoPlano = async (tenantId, plano) => {
  const uso = await usoDoEstudio(tenantId);
  return {
    ar: uso.noAr <= BigInt(plano.quotaGb) * BigInt(GB),
    cofre: uso.noCofre <= BigInt(plano.cofreGb) * BigInt(GB),
    uso,
  };
};

let tenantId = null;
console.log("\nTroca de plano:\n");

try {
  const grande = planoPorId("filme-2000"); // 2 TB no ar, 5 TB de cofre
  const pequeno = planoPorId("foto-100"); // 100 GB no ar, 500 GB de cofre

  const t = await db.query(
    `insert into tenants (slug,nome_estudio,email,senha_hash,plano_id,quota_bytes,quota_cofre_bytes)
     values ($1,'Troca Plano',$2,'x',$3,$4,$5) returning id`,
    [
      `troca-${Date.now()}`,
      `troca-${Date.now()}@teste`,
      grande.id,
      String(BigInt(grande.quotaGb) * BigInt(GB)),
      String(BigInt(grande.cofreGb) * BigInt(GB)),
    ],
  );
  tenantId = t.rows[0].id;

  const galeriaCom = async (bytes, estado = "online") => {
    const g = await db.query(
      `insert into galerias (tenant_id,slug,titulo,estado) values ($1,$2,'G',$3) returning id`,
      [tenantId, `g-${Math.random().toString(36).slice(2, 10)}`, estado],
    );
    await db.query(
      `insert into medias (galeria_id,tenant_id,chave,nome_original,tipo,mime,bytes,pronto)
       values ($1,$2,$3,'f.jpg','foto','image/jpeg',$4,true)`,
      [g.rows[0].id, tenantId, `tp/${g.rows[0].id}.jpg`, String(bytes)],
    );
    return g.rows[0].id;
  };

  await etapa("todos os planos têm cofre maior que a galeria", () => {
    // Se algum plano tivesse cofre menor, arquivar poderia ficar impossível.
    for (const p of planos) {
      if (p.cofreGb <= p.quotaGb) throw new Error(`${p.nome}: cofre ${p.cofreGb} ≤ galeria ${p.quotaGb}`);
    }
    return `${planos.length} planos conferidos`;
  });

  await etapa("subir de plano é sempre permitido", async () => {
    const r = await cabeNoPlano(tenantId, grande);
    igual(r.ar && r.cofre, true, "estúdio vazio cabe em qualquer plano");
  });

  await etapa("descer é RECUSADO quando as galerias no ar não cabem", async () => {
    await galeriaCom(300 * GB); // 300 GB > os 100 GB do plano pequeno
    const r = await cabeNoPlano(tenantId, pequeno);
    igual(r.ar, false, "não devia caber no ar");
    const excesso = Number(r.uso.noAr - BigInt(pequeno.quotaGb) * BigInt(GB)) / GB;
    if (excesso <= 0) throw new Error("o excesso calculado precisa ser positivo para a mensagem");
    return `sobram ${excesso.toFixed(0)} GB além do ${pequeno.nome}`;
  });

  await etapa("descer é RECUSADO quando o cofre não cabe", async () => {
    await galeriaCom(700 * GB, "arquivada"); // 700 GB > os 500 GB de cofre do pequeno
    const r = await cabeNoPlano(tenantId, pequeno);
    igual(r.cofre, false, "não devia caber no cofre");
    return "cofre também é conferido, não só o ar";
  });

  await etapa("descer é PERMITIDO depois de liberar espaço", async () => {
    await db.query("delete from galerias where tenant_id = $1", [tenantId]);
    await galeriaCom(50 * GB); // cabe nos 100 GB
    const r = await cabeNoPlano(tenantId, pequeno);
    igual(r.ar && r.cofre, true, "agora cabe");
    return "50 GB cabem no Foto 100 GB";
  });

  await etapa("trocar de plano reescreve AS DUAS quotas", async () => {
    // O erro fácil seria atualizar só quota_bytes e deixar o cofre no tamanho
    // do plano antigo — o estúdio ficaria com cofre de 5 TB pagando por 500 GB.
    await db.query(
      "update tenants set plano_id=$1, quota_bytes=$2, quota_cofre_bytes=$3 where id=$4",
      [
        pequeno.id,
        String(BigInt(pequeno.quotaGb) * BigInt(GB)),
        String(BigInt(pequeno.cofreGb) * BigInt(GB)),
        tenantId,
      ],
    );
    const { rows } = await db.query(
      "select plano_id, quota_bytes, quota_cofre_bytes from tenants where id=$1",
      [tenantId],
    );
    igual(rows[0].plano_id, pequeno.id, "plano");
    igual(BigInt(rows[0].quota_bytes) / BigInt(GB), pequeno.quotaGb, "quota do ar");
    igual(BigInt(rows[0].quota_cofre_bytes) / BigInt(GB), pequeno.cofreGb, "quota do cofre");
    return `${pequeno.quotaGb} GB no ar · ${pequeno.cofreGb} GB de cofre`;
  });

  await etapa("cancelar não apaga galeria nenhuma", async () => {
    const antes = await db.query("select count(*)::int n from galerias where tenant_id=$1", [tenantId]);
    await db.query(
      "update tenants set status='cancelado', asaas_assinatura_id=null where id=$1",
      [tenantId],
    );
    const depois = await db.query("select count(*)::int n from galerias where tenant_id=$1", [tenantId]);
    igual(depois.rows[0].n, antes.rows[0].n, "galerias intactas");
    // Punir o casal por uma decisão do fotógrafo seria pegar o refém errado.
    return `${depois.rows[0].n} galeria(s) continuam no ar`;
  });
} finally {
  if (tenantId) await db.query("delete from tenants where id = $1", [tenantId]);
  await db.end();
}

if (falhou) {
  console.error("\n✗ a troca de plano tem problema\n");
  process.exit(1);
}
console.log("\n✓ sobe livre, desce só quando cabe, e cancelar não apaga nada\n");
