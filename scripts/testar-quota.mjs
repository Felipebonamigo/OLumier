#!/usr/bin/env node
/**
 * Prova que o estúdio tem UM espaço só. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-quota.mjs
 *
 * ── A HISTÓRIA DESTE ARQUIVO ──────────────────────────────────────────────
 * Ele já provou o contrário. Até 25/08/2026 o cofre tinha balde próprio
 * (`quota_cofre_bytes`) e este teste garantia que arquivar LIBERAVA espaço no
 * ar. Fazia sentido enquanto o GB no ar e o GB parado custassem diferente.
 *
 * Com tudo no Backblaze B2 eles passaram a custar o mesmo, o cofre deixou de
 * ser peça de preço, e os dois baldes viraram um. O que este arquivo prende
 * agora é o outro lado da moeda, e é o que mais importa para o cliente:
 *
 *   ARQUIVAR E REATIVAR NÃO PODEM FALHAR.
 *
 * Num balde só, mudar de estado não muda o total — então não existe motivo
 * físico para recusar. E a recusa antiga era pior que inútil: `quota_cofre_bytes`
 * nascia zero (migração 007), então o cliente padrão levava "não cabe no seu
 * cofre" na primeira vez que tentava usar o recurso que o produto mais vende.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { usoDoEstudio, bytesUsados } from "../src/lib/medias.ts";
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

const criarEstudio = async (quota) => {
  const r = await db.query(
    `insert into tenants (slug,nome_estudio,email,senha_hash,quota_bytes)
     values ($1,'Quota',$2,'x',$3) returning id`,
    [`quota-${Date.now()}`, `q-${Date.now()}@teste`, String(quota)],
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
    [g.rows[0].id, tid, `q/${g.rows[0].id}.jpg`, String(bytes)],
  );
  return g.rows[0].id;
};

console.log("\nUm espaço só:\n");

try {
  tenantId = await criarEstudio(100 * GB);

  let arquivavel = null;

  await etapa("no ar e arquivado somam no mesmo espaço", async () => {
    await criarGaleria(tenantId, 60 * GB);
    arquivavel = await criarGaleria(tenantId, 30 * GB, "arquivada");
    const u = await usoDoEstudio(tenantId);
    igual(u.noAr / BigInt(GB), 60, "no ar");
    igual(u.noCofre / BigInt(GB), 30, "arquivado");
    igual((u.noAr + u.noCofre) / BigInt(GB), 90, "total");
    return "60 no ar + 30 arquivado = 90 GB de 100";
  });

  await etapa("reativar NÃO pode falhar — o total não muda", async () => {
    const r = await reativar(arquivavel, tenantId);
    if (!r.ok) throw new Error(`recusou: ${r.erro}`);
    const u = await usoDoEstudio(tenantId);
    igual((u.noAr + u.noCofre) / BigInt(GB), 90, "total depois de reativar");
    igual(u.noAr / BigInt(GB), 90, "tudo no ar agora");
    return "total intacto: 90 GB";
  });

  await etapa("arquivar NÃO pode falhar — o total não muda", async () => {
    const r = await arquivarAgora(arquivavel, tenantId);
    if (!r.ok) throw new Error(`recusou: ${r.erro}`);
    const u = await usoDoEstudio(tenantId);
    igual((u.noAr + u.noCofre) / BigInt(GB), 90, "total depois de arquivar");
    return "total intacto: 90 GB";
  });

  /*
   * O caso que a versão antiga recusava, e que era o pior de todos: o estúdio
   * está com o espaço quase cheio e quer arquivar. Antes ouvia "não cabe no seu
   * cofre" e a única saída oferecida era APAGAR entrega — exatamente o que a
   * página /seguranca promete que nunca é preciso fazer.
   */
  await etapa("arquivar funciona mesmo com o espaço no talo", async () => {
    const quase = await criarGaleria(tenantId, 9 * GB);
    const u1 = await usoDoEstudio(tenantId);
    igual((u1.noAr + u1.noCofre) / BigInt(GB), 99, "99 de 100 GB usados");

    const r = await arquivarAgora(quase, tenantId);
    if (!r.ok) throw new Error(`recusou com o espaço cheio: ${r.erro}`);

    const { rows } = await db.query("select estado from galerias where id = $1", [quase]);
    igual(rows[0].estado, "arquivada", "estado");
    return "99/100 GB e arquivou sem reclamar";
  });

  /*
   * A contrapartida honesta da unificação: arquivar não devolve espaço. Quem
   * encheu precisa subir de faixa — e é por isso que a grade barateia o GB a
   * cada degrau (ver planos.ts), para subir ser mais atraente que apagar.
   */
  await etapa("arquivar NÃO libera espaço para enviar mais", async () => {
    const u = await usoDoEstudio(tenantId);
    const total = u.noAr + u.noCofre;
    const limite = BigInt(100) * BigInt(GB);
    if (total !== BigInt(99) * BigInt(GB)) throw new Error(`total inesperado: ${total}`);
    const livre = Number(limite - total) / GB;
    igual(livre, 1, "GB livres");
    return "1 GB livre, com ou sem arquivamento";
  });

  /*
   * O furo que a unificação abriria se o portão de upload continuasse contando
   * só o que está no ar: arquivar viraria espaço grátis. O fotógrafo arquivaria
   * tudo e enviaria sem limite, e a fatura do B2 subiria sem receita atrás.
   * É o mesmo bug que existia ANTES de 20/08 (uma quota só, arquivar não
   * liberava nada) — só que ao contrário.
   */
  await etapa("o portão de upload conta o arquivado também", async () => {
    const u = await usoDoEstudio(tenantId);
    const usados = await bytesUsados(tenantId);
    igual(usados / BigInt(GB), (u.noAr + u.noCofre) / BigInt(GB), "bytes usados");
    if (usados === u.noAr) throw new Error("está contando só o que está no ar");
    return `${Number(usados) / GB} GB contados, com arquivado incluso`;
  });
} finally {
  if (tenantId) await db.query("delete from tenants where id = $1", [tenantId]);
  await db.end();
}

if (falhou) {
  console.error("\n✗ a quota tem problema\n");
  process.exit(1);
}
console.log("\n✓ um espaço só: arquivar e reativar nunca falham\n");
