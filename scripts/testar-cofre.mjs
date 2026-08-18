#!/usr/bin/env node
/**
 * Testa o prazo e o cofre. Uso:
 *   node --env-file=.env.local scripts/testar-cofre.mjs
 *
 * O que está em jogo é a promessa central do produto: "o link sai do ar, mas
 * nada é apagado". Se arquivar perdesse foto, o argumento inteiro cai.
 */
import { execFileSync } from "node:child_process";
import pg from "pg";

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

// Estado limpo para começar.
await db.query(
  "update galerias set publicada = true, senha_hash = null, estado = 'online', expira_em = null, arquivada_em = null where id = $1",
  [galeriaId],
);

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
const texto = async (r) => (await r.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const contarFotos = async () => {
  const { rows: r } = await db.query(
    "select count(*)::int n, coalesce(sum(bytes),0)::text b from medias where galeria_id = $1 and pronto",
    [galeriaId],
  );
  return { n: r[0].n, bytes: r[0].b };
};

const antes = await contarFotos();
if (antes.n === 0) {
  console.error("✗ preciso de fotos na galeria para testar");
  process.exit(1);
}

await etapa("galeria no ar abre normalmente", async () => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await texto(r);
  if (t.includes("cofre")) throw new Error("mostrou aviso de cofre estando no ar");
  return `${antes.n} fotos visíveis`;
});

await etapa("prazo vencido é arquivado pelo script diário", async () => {
  await db.query("update galerias set expira_em = now() - interval '1 day' where id = $1", [
    galeriaId,
  ]);
  const saida = execFileSync(
    process.execPath,
    ["--env-file=.env.local", "scripts/arquivar-vencidas.mjs"],
    { encoding: "utf8" },
  );
  const { rows: g } = await db.query("select estado, arquivada_em from galerias where id = $1", [
    galeriaId,
  ]);
  if (g[0].estado !== "arquivada") throw new Error(`estado ficou "${g[0].estado}"`);
  if (!g[0].arquivada_em) throw new Error("não registrou quando arquivou");
  if (!saida.includes("cofre")) throw new Error("o script não registrou no log");
  return saida.trim().split("\n")[0].split(" ").slice(1).join(" ");
});

await etapa("NENHUMA foto foi apagada ao arquivar", async () => {
  const depois = await contarFotos();
  if (depois.n !== antes.n) throw new Error(`${antes.n} → ${depois.n} fotos`);
  if (depois.bytes !== antes.bytes) throw new Error(`bytes mudaram: ${antes.bytes} → ${depois.bytes}`);
  return `${depois.n} fotos e ${depois.bytes} bytes intactos`;
});

await etapa("o link avisa que está no cofre, sem dar erro", async () => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} — devia responder normalmente`);
  const t = await texto(r);
  if (!t.includes("cofre")) throw new Error("não explicou que está no cofre");
  if (!t.includes("nada foi perdido")) throw new Error("não tranquilizou o cliente");
  return "página explicativa, HTTP 200";
});

await etapa("enviar arquivo para galeria no cofre é recusado", async () => {
  const { createHmac } = await import("node:crypto");
  const { rows: t } = await db.query(
    "select tenant_id from galerias where id = $1",
    [galeriaId],
  );
  const expira = Date.now() + 60_000;
  const d = `${t[0].tenant_id}.${expira}`;
  const cookie = `fotonio_sessao=${d}.${createHmac("sha256", process.env.SESSION_SECRET).update(d).digest("hex")}`;
  const r = await fetch(`${BASE}/api/galerias/${galeriaId}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ nome: "x.jpg", mime: "image/jpeg", bytes: 1000 }),
  });
  if (r.status !== 409) throw new Error(`esperava 409, veio ${r.status}`);
  return "HTTP 409";
});

await etapa("reativar traz de volta com o MESMO link", async () => {
  await db.query(
    `update galerias set estado = 'online', arquivada_em = null,
        expira_em = case when expira_em is null then null else now() + interval '12 months' end
      where id = $1`,
    [galeriaId],
  );
  const r = await fetch(url, { cache: "no-store" });
  const t = await texto(r);
  if (t.includes("guardada no cofre")) throw new Error("ainda mostra o cofre");
  const depois = await contarFotos();
  if (depois.n !== antes.n) throw new Error("fotos sumiram na volta");
  const { rows: g } = await db.query("select expira_em from galerias where id = $1", [galeriaId]);
  const dias = Math.round((new Date(g[0].expira_em) - Date.now()) / 86400000);
  if (dias < 300) throw new Error(`voltou com só ${dias} dias — venceria de novo logo`);
  return `${depois.n} fotos de volta, com ${dias} dias de prazo novo`;
});

await etapa("galeria SEM prazo nunca é arquivada", async () => {
  await db.query("update galerias set expira_em = null where id = $1", [galeriaId]);
  execFileSync(process.execPath, ["--env-file=.env.local", "scripts/arquivar-vencidas.mjs"], {
    encoding: "utf8",
  });
  const { rows: g } = await db.query("select estado from galerias where id = $1", [galeriaId]);
  if (g[0].estado !== "online") throw new Error("arquivou sem prazo definido!");
  return "segue no ar";
});

await etapa("uso separa o que está no ar do que está no cofre", async () => {
  const { rows: t } = await db.query("select tenant_id from galerias where id = $1", [galeriaId]);
  const { rows: u } = await db.query(
    `select
       coalesce(sum(m.bytes) filter (where g.estado = 'online'), 0)::text as no_ar,
       coalesce(sum(m.bytes) filter (where g.estado = 'arquivada'), 0)::text as no_cofre
     from medias m join galerias g on g.id = m.galeria_id
     where m.tenant_id = $1 and m.pronto`,
    [t[0].tenant_id],
  );
  if (u[0].no_ar === "0") throw new Error("não contou o que está no ar");
  return `${u[0].no_ar} bytes no ar · ${u[0].no_cofre} no cofre`;
});

await db.end();

if (falhou) {
  console.error("\n✗ o cofre tem problema");
  process.exit(1);
}
console.log("\n✓ cofre íntegro — arquiva sozinho, não apaga nada, reativa em um clique");
