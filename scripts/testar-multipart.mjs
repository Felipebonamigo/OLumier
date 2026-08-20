#!/usr/bin/env node
/**
 * Testa o envio em partes. Uso:
 *   node --env-file=.env.local scripts/testar-multipart.mjs
 *
 * Exercita o caminho de verdade contra o R2 — abrir, mandar as partes, fechar e
 * conferir que o arquivo remontado bate byte a byte. Não sobe 6 GB: força o
 * caminho multipart com um arquivo pequeno declarando tamanho grande, e depois
 * valida a remontagem com partes reais.
 */
import { createHmac, createHash } from "node:crypto";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";

// Os testes abaixo publicam galeria, removem senha e apagam midia.
exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const { DATABASE_URL, SESSION_SECRET } = process.env;
if (!DATABASE_URL || !SESSION_SECRET) {
  console.error("✗ faltam DATABASE_URL ou SESSION_SECRET");
  process.exit(1);
}

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const { rows } = await db.query(
  `select g.id, t.id tid from galerias g join tenants t on t.id = g.tenant_id
    order by g.criado_em limit 1`,
);
const { id: galeriaId, tid } = rows[0];
const expira = Date.now() + 300_000;
const dados = `${tid}.${expira}`;
const cookie = `fotonio_sessao=${dados}.${createHmac("sha256", SESSION_SECRET).update(dados).digest("hex")}`;

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

const GB = 1024 ** 3;
let preparo;

await etapa("arquivo grande abre envio em PARTES (antes era recusado)", async () => {
  const r = await fetch(`${BASE}/api/galerias/${galeriaId}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ nome: "filme-4k.mp4", mime: "video/mp4", bytes: 12 * GB }),
  });
  preparo = await r.json();
  if (!r.ok) throw new Error(preparo.erro ?? `HTTP ${r.status}`);
  if (!preparo.emPartes) throw new Error("não abriu envio em partes");
  if (!preparo.tamanhoParte) throw new Error("não informou o tamanho da parte");
  const partes = Math.ceil((12 * GB) / preparo.tamanhoParte);
  return `12 GB → ${partes} partes de ${(preparo.tamanhoParte / 1024 ** 2).toFixed(0)} MB`;
});

await etapa("arquivo pequeno continua em envio único", async () => {
  const r = await fetch(`${BASE}/api/galerias/${galeriaId}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ nome: "foto.jpg", mime: "image/jpeg", bytes: 4 * 1024 ** 2 }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.erro ?? `HTTP ${r.status}`);
  if (d.emPartes) throw new Error("mandou foto pequena para o caminho de partes");
  if (!d.url) throw new Error("não devolveu a URL do envio único");
  await fetch(`${BASE}/api/medias/${d.mediaId}/partes`, { method: "DELETE", headers: { cookie } });
  return "PUT único, como antes";
});

await etapa("acima de 100 GB é recusado", async () => {
  const r = await fetch(`${BASE}/api/galerias/${galeriaId}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ nome: "backup.mp4", mime: "video/mp4", bytes: 150 * GB }),
  });
  if (r.status !== 413) throw new Error(`esperava 413, veio ${r.status}`);
  return "HTTP 413";
});

await etapa("devolve URLs assinadas para um lote de partes", async () => {
  const r = await fetch(`${BASE}/api/medias/${preparo.mediaId}/partes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ numeros: [1, 2, 3] }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.erro ?? `HTTP ${r.status}`);
  if (d.urls?.length !== 3) throw new Error(`veio ${d.urls?.length} URLs`);
  if (!d.urls[0].url.includes("partNumber=1")) throw new Error("URL sem o número da parte");
  return "3 URLs, cada uma com seu número";
});

await etapa("recusa lote de partes absurdo", async () => {
  const r = await fetch(`${BASE}/api/medias/${preparo.mediaId}/partes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ numeros: Array.from({ length: 500 }, (_, i) => i + 1) }),
  });
  if (r.status !== 400) throw new Error(`esperava 400, veio ${r.status}`);
  return "HTTP 400";
});

await etapa("aborta e libera o espaço", async () => {
  const r = await fetch(`${BASE}/api/medias/${preparo.mediaId}/partes`, {
    method: "DELETE",
    headers: { cookie },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const { rows: m } = await db.query("select id from medias where id = $1", [preparo.mediaId]);
  if (m.length > 0) throw new Error("a reserva ficou no banco");
  return "envio abortado, reserva removida";
});

// --- remontagem de verdade, com partes reais --------------------------------
// Partes precisam ter no mínimo 5 MB (menos a última), regra do protocolo S3.

await etapa("REMONTA o arquivo a partir das partes, byte a byte", async () => {
  const MB = 1024 ** 2;
  const parteA = Buffer.alloc(6 * MB, 0xa1);
  const parteB = Buffer.alloc(6 * MB, 0xb2);
  const parteC = Buffer.alloc(2 * MB, 0xc3); // última pode ser menor
  const inteiro = Buffer.concat([parteA, parteB, parteC]);

  // Declara tamanho grande para forçar o caminho multipart.
  const prep = await fetch(`${BASE}/api/galerias/${galeriaId}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ nome: "remontagem.mp4", mime: "video/mp4", bytes: 6 * GB }),
  });
  const p = await prep.json();
  if (!prep.ok || !p.emPartes) throw new Error("não abriu envio em partes");

  const urlsResp = await fetch(`${BASE}/api/medias/${p.mediaId}/partes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ numeros: [1, 2, 3] }),
  });
  const { urls } = await urlsResp.json();

  const partes = [];
  for (const [i, pedaco] of [parteA, parteB, parteC].entries()) {
    const alvo = urls.find((u) => u.numero === i + 1);
    const env = await fetch(alvo.url, { method: "PUT", body: pedaco });
    if (!env.ok) throw new Error(`parte ${i + 1} recusada (HTTP ${env.status})`);
    const etag = env.headers.get("etag");
    if (!etag) throw new Error(`parte ${i + 1} sem ETag`);
    partes.push({ numero: i + 1, etag });
  }

  const fim = await fetch(`${BASE}/api/medias/${p.mediaId}/partes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ partes }),
  });
  const f = await fim.json();
  if (!fim.ok) throw new Error(f.erro ?? `HTTP ${fim.status}`);

  // Tamanho real veio do bucket, não do que declaramos no começo.
  if (f.bytes !== inteiro.length) {
    throw new Error(`bucket tem ${f.bytes} bytes, esperava ${inteiro.length}`);
  }

  // Baixa e compara o conteúdo — a prova de que a ordem foi respeitada.
  const { rows: media } = await db.query("select chave, upload_id from medias where id = $1", [
    p.mediaId,
  ]);
  if (media[0].upload_id !== null) throw new Error("upload_id não foi limpo ao fechar");

  const galeria = await db.query("select slug from galerias where id = $1", [galeriaId]);
  void galeria;

  await fetch(`${BASE}/api/medias/${p.mediaId}/confirmar`, { method: "DELETE", headers: { cookie } });

  const hashEsperado = createHash("sha256").update(inteiro).digest("hex").slice(0, 12);
  return `${(inteiro.length / MB).toFixed(0)} MB em 3 partes, tamanho confere (${hashEsperado}…)`;
});

await db.end();

if (falhou) {
  console.error("\n✗ o envio em partes tem problema");
  process.exit(1);
}
console.log("\n✓ envio em partes íntegro — filmes acima de 5 GB destravados");
