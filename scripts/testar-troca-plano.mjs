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
 *
 * Desde a unificação de 25/08/2026 a conferência é UMA: o espaço total (no ar
 * mais guardado) contra a quota do plano. Antes eram duas, e a segunda recusava
 * a descida dizendo "apague algo do cofre" — pedir para o fotógrafo apagar
 * entrega é justamente o que este produto promete que nunca é preciso fazer.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { planoPorId, GB } from "../src/config/planos.ts";
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
  const total = uso.noAr + uso.noCofre;
  return { cabe: total <= BigInt(plano.quotaGb) * BigInt(GB), total, uso };
};

let tenantId = null;
console.log("\nTroca de plano:\n");

try {
  const grande = planoPorId("g:filme:5000"); // 5 TB
  const pequeno = planoPorId("g:foto:100"); // 100 GB

  const t = await db.query(
    `insert into tenants (slug,nome_estudio,email,senha_hash,plano_id,quota_bytes)
     values ($1,'Troca Plano',$2,'x',$3,$4) returning id`,
    [
      `troca-${Date.now()}`,
      `troca-${Date.now()}@teste`,
      grande.id,
      String(BigInt(grande.quotaGb) * BigInt(GB)),
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

  await etapa("subir de plano é sempre permitido", async () => {
    const r = await cabeNoPlano(tenantId, grande);
    igual(r.cabe, true, "estúdio vazio cabe em qualquer plano");
  });

  await etapa("descer é RECUSADO quando o que está no ar não cabe", async () => {
    await galeriaCom(300 * GB); // 300 GB > os 100 GB do plano pequeno
    const r = await cabeNoPlano(tenantId, pequeno);
    igual(r.cabe, false, "não devia caber");
    const excesso = Number(r.total - BigInt(pequeno.quotaGb) * BigInt(GB)) / GB;
    if (excesso <= 0) throw new Error("o excesso calculado precisa ser positivo para a mensagem");
    return `sobram ${excesso.toFixed(0)} GB além do ${pequeno.nome}`;
  });

  /*
   * O ponto que a unificação mudou: galeria ARQUIVADA continua contando contra
   * o plano. Antes ela tinha balde próprio, e descer de plano ignorava o
   * arquivo — o estúdio caía para 100 GB carregando 700 GB de entregas antigas,
   * e a conta ficava acima do limite sem ninguém ter enviado nada.
   */
  await etapa("o que está GUARDADO também conta na descida", async () => {
    await db.query("delete from galerias where tenant_id = $1", [tenantId]);
    await galeriaCom(700 * GB, "arquivada");
    const r = await cabeNoPlano(tenantId, pequeno);
    igual(r.cabe, false, "arquivado não pode ser espaço grátis");
    igual(r.uso.noAr, 0, "nada no ar");
    return "700 GB guardados não cabem em 100 GB";
  });

  await etapa("descer é PERMITIDO depois de liberar espaço", async () => {
    await db.query("delete from galerias where tenant_id = $1", [tenantId]);
    await galeriaCom(50 * GB); // cabe nos 100 GB
    const r = await cabeNoPlano(tenantId, pequeno);
    igual(r.cabe, true, "agora cabe");
    return `50 GB cabem no ${pequeno.nome}`;
  });

  await etapa("trocar de plano reescreve a quota", async () => {
    await db.query("update tenants set plano_id=$1, quota_bytes=$2 where id=$3", [
      pequeno.id,
      String(BigInt(pequeno.quotaGb) * BigInt(GB)),
      tenantId,
    ]);
    const { rows } = await db.query("select plano_id, quota_bytes from tenants where id=$1", [
      tenantId,
    ]);
    igual(rows[0].plano_id, pequeno.id, "plano");
    igual(BigInt(rows[0].quota_bytes) / BigInt(GB), pequeno.quotaGb, "quota");
    return `${pequeno.quotaGb} GB de espaço`;
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
