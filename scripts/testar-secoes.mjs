#!/usr/bin/env node
/**
 * Testa capítulos. Uso:
 *   node --env-file=.env.local scripts/testar-secoes.mjs
 *
 * O comportamento mais importante aqui é o de APAGAR: o fotógrafo precisa poder
 * apagar um capítulo sem medo de levar as fotos junto.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { criarSecao } from "../src/lib/secoes.ts";

// Os testes abaixo publicam galeria, removem senha e apagam midia.
exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const { rows } = await db.query(
  `select g.id, g.slug gslug, t.slug tslug
     from galerias g join tenants t on t.id = g.tenant_id
    order by g.criado_em limit 1`,
);
const { id: galeriaId, gslug, tslug } = rows[0];
const url = `${BASE}/g/${tslug}/${gslug}`;

await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [galeriaId]);
await db.query("delete from secoes where galeria_id = $1", [galeriaId]);

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
const texto = async (r) =>
  (await r.text()).replace(/<[^>]+>/g, " ").replaceAll("&amp;", "&").replace(/\s+/g, " ");

const { rows: fotos } = await db.query(
  "select id from medias where galeria_id = $1 and pronto order by criado_em",
  [galeriaId],
);
if (fotos.length < 2) {
  console.error("✗ preciso de ao menos 2 fotos na galeria para testar");
  process.exit(1);
}

let capA, capB;

await etapa("cria capítulos em ordem", async () => {
  const r = await db.query(
    `insert into secoes (galeria_id, nome, ordem) values ($1,'Cerimônia',0), ($1,'Festa',1) returning id, nome`,
    [galeriaId],
  );
  [capA, capB] = r.rows;
  return `${r.rows.map((s) => s.nome).join(" · ")}`;
});

await etapa("capítulo repetido é recusado, mesmo trocando maiúscula", async () => {
  /* "Making Of" e "Making of" são o mesmo capítulo para qualquer humano, e o
   * banco os aceitava como dois. O estrago não é no painel — é no menu que o
   * casal vê, com duas entradas de mesmo nome e as fotos partidas entre elas.
   *
   * A comparação ignora caixa E espaço nas pontas: quem digita rápido erra
   * nesses dois, e são justamente os que não mudam o nome aos olhos de ninguém. */
  const { rows: t } = await db.query("select tenant_id from galerias where id = $1", [galeriaId]);
  const tenantId = t[0].tenant_id;

  const primeiro = await criarSecao(galeriaId, tenantId, "Making Of");
  if (!primeiro) throw new Error("não criou nem o primeiro capítulo");

  const repetido = await criarSecao(galeriaId, tenantId, "  making of  ");
  if (repetido) {
    await db.query("delete from secoes where id = any($1)", [[primeiro.id, repetido.id]]);
    throw new Error(`criou "${repetido.nome}" com "Making Of" já existindo`);
  }

  await db.query("delete from secoes where id = $1", [primeiro.id]);
  return "recusou a repetição";
});

await etapa("capítulo vazio não vira seção em branco na página", async () => {
  const t = await texto(await fetch(url, { cache: "no-store" }));
  if (t.includes("Cerimônia")) throw new Error("mostrou capítulo sem fotos");
  return "escondido";
});

await etapa("fotos movidas aparecem sob o capítulo", async () => {
  await db.query("update medias set secao_id = $1 where id = $2", [capA.id, fotos[0].id]);
  await db.query("update medias set secao_id = $1 where id = $2", [capB.id, fotos[1].id]);
  const t = await texto(await fetch(url, { cache: "no-store" }));
  if (!t.includes("Cerimônia") || !t.includes("Festa")) throw new Error("capítulos não apareceram");
  return "Cerimônia e Festa na página";
});

await etapa("menu de navegação aparece com 2+ capítulos", async () => {
  const html = await (await fetch(url, { cache: "no-store" })).text();
  if (!html.includes(`#cap-${capA.id}`)) throw new Error("sem âncora para o capítulo");
  if (!html.includes("Capítulos da galeria")) throw new Error("sem o menu de navegação");
  return "âncoras e menu presentes";
});

await etapa("ordem do fotógrafo é respeitada na página", async () => {
  const t = await texto(await fetch(url, { cache: "no-store" }));
  const posCerimonia = t.indexOf("Cerimônia", t.indexOf("Capítulos da galeria") + 40);
  const posFesta = t.indexOf("Festa", t.indexOf("Capítulos da galeria") + 40);
  if (posCerimonia === -1 || posFesta === -1) throw new Error("capítulos não localizados");
  if (posCerimonia > posFesta) throw new Error("ordem invertida");

  // inverte a ordem e confere que a página acompanha
  await db.query("update secoes set ordem = 1 where id = $1", [capA.id]);
  await db.query("update secoes set ordem = 0 where id = $1", [capB.id]);
  const t2 = await texto(await fetch(url, { cache: "no-store" }));
  const base = t2.indexOf("Capítulos da galeria") + 40;
  if (t2.indexOf("Festa", base) > t2.indexOf("Cerimônia", base)) {
    throw new Error("não acompanhou a reordenação");
  }
  await db.query("update secoes set ordem = 0 where id = $1", [capA.id]);
  await db.query("update secoes set ordem = 1 where id = $1", [capB.id]);
  return "reordenar muda a página";
});

await etapa("APAGAR capítulo não apaga as fotos", async () => {
  const antes = await db.query("select count(*)::int n from medias where galeria_id = $1 and pronto", [galeriaId]);
  await db.query("delete from secoes where id = $1", [capB.id]);
  const depois = await db.query("select count(*)::int n from medias where galeria_id = $1 and pronto", [galeriaId]);
  if (depois.rows[0].n !== antes.rows[0].n) {
    throw new Error(`perdeu fotos: ${antes.rows[0].n} → ${depois.rows[0].n}`);
  }
  const orfa = await db.query("select secao_id from medias where id = $1", [fotos[1].id]);
  if (orfa.rows[0].secao_id !== null) throw new Error("a foto ficou apontando para capítulo apagado");
  return `${depois.rows[0].n} fotos intactas, a órfã voltou para "sem capítulo"`;
});

await etapa("galeria segue abrindo com capítulo apagado", async () => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await texto(r);
  if (t.includes("Festa")) throw new Error("capítulo apagado ainda aparece");
  return "HTTP 200, sem resquício";
});

await etapa("apagar a galeria leva os capítulos junto", async () => {
  const { rows: g } = await db.query(
    "insert into galerias (tenant_id, slug, titulo) select tenant_id, 'teste-cascata', 'Teste' from galerias where id = $1 returning id",
    [galeriaId],
  );
  await db.query("insert into secoes (galeria_id, nome) values ($1, 'X')", [g[0].id]);
  await db.query("delete from galerias where id = $1", [g[0].id]);
  const sobrou = await db.query("select count(*)::int n from secoes where galeria_id = $1", [g[0].id]);
  if (sobrou.rows[0].n !== 0) throw new Error("sobraram capítulos órfãos");
  return "sem órfãos";
});

// Deixa uma estrutura bonita para o Felipe ver.
await db.query("delete from secoes where galeria_id = $1", [galeriaId]);
const { rows: novas } = await db.query(
  `insert into secoes (galeria_id, nome, ordem)
   values ($1,'Cerimônia',0), ($1,'Festa',1) returning id`,
  [galeriaId],
);
for (const [i, f] of fotos.entries()) {
  await db.query("update medias set secao_id = $1 where id = $2", [
    novas[i % novas.length].id,
    f.id,
  ]);
}
await db.end();

if (falhou) {
  console.error("\n✗ capítulos com problema");
  process.exit(1);
}
console.log(`\n✓ capítulos funcionando — veja em ${url}`);
