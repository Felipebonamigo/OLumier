#!/usr/bin/env node
/**
 * Testa o fluxo de upload de ponta a ponta, batendo nas rotas de verdade. Uso:
 *   node --env-file=.env.local scripts/testar-upload.mjs
 *
 * Precisa do servidor de desenvolvimento rodando. Não passa por navegador, então
 * NÃO testa CORS — testa a lógica: autorização, quota, URL assinada, envio,
 * confirmação com tamanho real e o trigger de uso de espaço.
 */
import { createHmac } from "node:crypto";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const { DATABASE_URL, SESSION_SECRET } = process.env;

if (!DATABASE_URL || !SESSION_SECRET) {
  console.error("✗ faltam DATABASE_URL ou SESSION_SECRET no .env.local");
  process.exit(1);
}

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

const { rows: tenants } = await db.query("select id, nome_estudio from tenants order by criado_em limit 1");
if (tenants.length === 0) {
  console.error("✗ nenhum tenant no banco — crie uma conta primeiro em /cadastrar");
  process.exit(1);
}
const tenant = tenants[0];

const { rows: galerias } = await db.query(
  "select id, titulo from galerias where tenant_id = $1 order by criado_em limit 1",
  [tenant.id],
);
if (galerias.length === 0) {
  console.error("✗ nenhuma galeria — crie uma em /painel/galerias/nova");
  process.exit(1);
}
const galeria = galerias[0];

console.log(`estúdio: ${tenant.nome_estudio}`);
console.log(`galeria: ${galeria.titulo}\n`);

// Monta um cookie de sessão válido, do mesmo jeito que o app monta.
const expira = Date.now() + 60_000;
const dados = `${tenant.id}.${expira}`;
const assinatura = createHmac("sha256", SESSION_SECRET).update(dados).digest("hex");
const cookie = `fotonio_sessao=${dados}.${assinatura}`;

// PNG 1x1 válido — o menor arquivo real possível para o teste.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
    return true;
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
    return false;
  }
};

let preparo;

await etapa("recusa tipo de arquivo não aceito", async () => {
  const r = await fetch(`${BASE}/api/galerias/${galeria.id}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ nome: "virus.exe", mime: "application/x-msdownload", bytes: 100 }),
  });
  if (r.status !== 415) throw new Error(`esperava 415, veio ${r.status}`);
  return "HTTP 415";
});

await etapa("recusa quem não está autenticado", async () => {
  const r = await fetch(`${BASE}/api/galerias/${galeria.id}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome: "a.png", mime: "image/png", bytes: 10 }),
  });
  if (r.status !== 401) throw new Error(`esperava 401, veio ${r.status}`);
  return "HTTP 401";
});

await etapa("prepara o envio", async () => {
  const r = await fetch(`${BASE}/api/galerias/${galeria.id}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ nome: "teste-upload.png", mime: "image/png", bytes: png.length }),
  });
  preparo = await r.json();
  if (!r.ok) throw new Error(preparo.erro ?? `HTTP ${r.status}`);
  return `media ${preparo.mediaId.slice(0, 8)}…`;
});

await etapa("envia o arquivo direto ao bucket", async () => {
  const r = await fetch(preparo.url, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return `${png.length} bytes`;
});

await etapa("confirma e grava o tamanho real", async () => {
  const r = await fetch(`${BASE}/api/medias/${preparo.mediaId}/confirmar`, {
    method: "POST",
    headers: { cookie },
  });
  const c = await r.json();
  if (!r.ok) throw new Error(c.erro ?? `HTTP ${r.status}`);
  if (c.bytes !== png.length) throw new Error(`bytes ${c.bytes} ≠ ${png.length}`);
  return `${c.bytes} bytes conferidos no bucket`;
});

await etapa("trigger atualizou o uso de espaço", async () => {
  const { rows } = await db.query(
    "select g.bytes_total, t.usado_bytes from galerias g join tenants t on t.id = g.tenant_id where g.id = $1",
    [galeria.id],
  );
  const { bytes_total, usado_bytes } = rows[0];
  if (Number(bytes_total) < png.length) throw new Error(`galeria com ${bytes_total} bytes`);
  if (Number(usado_bytes) < png.length) throw new Error(`tenant com ${usado_bytes} bytes`);
  return `galeria ${bytes_total} B · estúdio ${usado_bytes} B`;
});

await etapa("remove o arquivo de teste", async () => {
  const r = await fetch(`${BASE}/api/medias/${preparo.mediaId}/confirmar`, {
    method: "DELETE",
    headers: { cookie },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows } = await db.query("select usado_bytes from tenants where id = $1", [tenant.id]);
  return `espaço devolvido (estúdio agora com ${rows[0].usado_bytes} B)`;
});

await db.end();

if (falhou) {
  console.error("\n✗ o fluxo de upload tem problema");
  process.exit(1);
}
console.log("\n✓ fluxo de upload íntegro (autorização, quota, envio, confirmação e contabilidade)");
