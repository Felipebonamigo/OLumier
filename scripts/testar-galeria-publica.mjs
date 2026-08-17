#!/usr/bin/env node
/**
 * Testa a galeria pública de ponta a ponta. Uso:
 *   node --env-file=.env.local scripts/testar-galeria-publica.mjs
 *
 * Cobre o que mais importa nesta parte: galeria despublicada não abre, senha
 * errada não passa, senha certa libera, e o acesso fica registrado.
 */
import { createHash, createHmac } from "node:crypto";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const { DATABASE_URL, SESSION_SECRET } = process.env;
if (!DATABASE_URL || !SESSION_SECRET) {
  console.error("✗ faltam DATABASE_URL ou SESSION_SECRET");
  process.exit(1);
}

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

const { rows } = await db.query(
  `select g.id, g.slug as gslug, g.titulo, t.slug as tslug
     from galerias g join tenants t on t.id = g.tenant_id
    order by g.criado_em limit 1`,
);
if (rows.length === 0) {
  console.error("✗ nenhuma galeria no banco");
  process.exit(1);
}
const { id: galeriaId, gslug, tslug, titulo } = rows[0];
const url = `${BASE}/g/${tslug}/${gslug}`;
console.log(`galeria: ${titulo}\nlink:    ${url}\n`);

const SENHA = "anaepedro";
const hashDaSenha = (s) => {
  const sal = createHash("sha256").update(SESSION_SECRET).digest("hex").slice(0, 16);
  return createHash("sha256").update(sal + s).digest("hex");
};

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

/**
 * Texto visível da página. Decodifica as entidades HTML porque o React escapa a
 * saída — "Ana & Pedro" chega como "Ana &amp; Pedro". Esse escape é justamente o
 * que impede XSS, então o teste é que precisa se adaptar.
 */
const textoDe = async (r) =>
  (await r.text())
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));

await etapa("galeria despublicada não abre", async () => {
  await db.query("update galerias set publicada = false, senha_hash = null where id = $1", [galeriaId]);
  const r = await fetch(url, { redirect: "manual" });
  if (r.status !== 404) throw new Error(`esperava 404, veio ${r.status}`);
  return "HTTP 404";
});

await etapa("publicada e sem senha abre para qualquer um", async () => {
  await db.query("update galerias set publicada = true where id = $1", [galeriaId]);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const txt = await textoDe(r);
  if (!txt.includes(titulo)) throw new Error("título não apareceu na página");
  if (!txt.includes("entregue com")) throw new Error("selo do rodapé não apareceu");
  return "título e selo presentes";
});

await etapa("com senha, mostra o portão em vez das fotos", async () => {
  await db.query("update galerias set senha_hash = $1 where id = $2", [hashDaSenha(SENHA), galeriaId]);
  const r = await fetch(url);
  const txt = await textoDe(r);
  if (!txt.includes("protegida")) throw new Error("não mostrou o portão de senha");
  return "portão exibido";
});

await etapa("cookie forjado não abre a galeria", async () => {
  const falso = `${Date.now() + 60000}.${"0".repeat(64)}`;
  const r = await fetch(url, { headers: { cookie: `g_${galeriaId.slice(0, 8)}=${falso}` } });
  const txt = await textoDe(r);
  if (!txt.includes("protegida")) throw new Error("cookie inválido passou!");
  return "barrado";
});

await etapa("cookie assinado corretamente abre", async () => {
  const expira = Date.now() + 60000;
  const assinatura = createHmac("sha256", SESSION_SECRET)
    .update(`${galeriaId}.${expira}`)
    .digest("hex");
  const r = await fetch(url, {
    headers: { cookie: `g_${galeriaId.slice(0, 8)}=${expira}.${assinatura}` },
  });
  const txt = await textoDe(r);
  if (txt.includes("protegida")) throw new Error("ainda pede senha");
  if (!txt.includes(titulo)) throw new Error("não mostrou a galeria");
  return "galeria liberada";
});

await etapa("galeria no cofre avisa em vez de sumir", async () => {
  await db.query("update galerias set estado = 'arquivada' where id = $1", [galeriaId]);
  const r = await fetch(url);
  const txt = await textoDe(r);
  if (!txt.includes("cofre")) throw new Error("não avisou sobre o cofre");
  await db.query("update galerias set estado = 'online' where id = $1", [galeriaId]);
  return "aviso correto";
});

await etapa("registra acesso do cliente", async () => {
  const antes = await db.query("select count(*)::int n from acessos where galeria_id = $1", [galeriaId]);
  const r = await fetch(`${BASE}/api/g/${galeriaId}/acesso`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao: "baixou_tudo" }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const depois = await db.query("select count(*)::int n from acessos where galeria_id = $1", [galeriaId]);
  if (depois.rows[0].n <= antes.rows[0].n) throw new Error("nada foi registrado");
  const { rows: ip } = await db.query(
    "select ip_hash from acessos where galeria_id = $1 order by criado_em desc limit 1",
    [galeriaId],
  );
  return `${depois.rows[0].n} registros · ip guardado como hash: ${ip[0].ip_hash ? "sim" : "sem ip"}`;
});

await etapa("recusa ação inventada no registro", async () => {
  const r = await fetch(`${BASE}/api/g/${galeriaId}/acesso`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acao: "apagar_tudo" }),
  });
  if (r.status !== 400) throw new Error(`esperava 400, veio ${r.status}`);
  return "HTTP 400";
});

// Deixa a galeria como estava para o Felipe testar à mão.
await db.query("update galerias set senha_hash = null, publicada = true where id = $1", [galeriaId]);
await db.end();

if (falhou) {
  console.error("\n✗ a galeria pública tem problema");
  process.exit(1);
}
console.log(`\n✓ galeria pública íntegra — deixei publicada e SEM senha em ${url}`);
