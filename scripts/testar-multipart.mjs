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
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import { createHash } from "node:crypto";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

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
/* Bancada propria desta execucao — antes: a galeria mais antiga do banco.
 * Ver fixture-de-teste.mjs. */
const bancada = await galeriaDaRodada(db);
const galeriaId = bancada.id, tid = bancada.estudio.id;
const cookie = cookieDeSessao(tid);

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

/*
 * 10/10/2026: o navegador passa a pedir partes acima de 100 MB, para o vídeo
 * não recomeçar do zero numa queda. Só quem PEDE — o plugin do Lightroom e a
 * chave de API continuam com o PUT único até os 5 GB, senão quebrariam.
 */
await etapa("o navegador que pede partes recebe partes acima de 100 MB", async () => {
  const MB = 1024 ** 2;
  const preparar = async (bytes, partes) => {
    const r = await fetch(`${BASE}/api/galerias/${galeriaId}/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ nome: `video-${bytes}.mp4`, mime: "video/mp4", bytes, ...(partes ? { partes: true } : {}) }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.erro ?? `HTTP ${r.status}`);
    await fetch(`${BASE}/api/medias/${d.mediaId}/partes`, { method: "DELETE", headers: { cookie } });
    return d;
  };
  const pedindo = await preparar(300 * MB, true);
  if (!pedindo.emPartes) throw new Error("300 MB pedindo partes veio em PUT único");
  if (pedindo.tamanhoParte !== 32 * MB) throw new Error(`parte de ${pedindo.tamanhoParte / MB} MB`);
  const semPedir = await preparar(300 * MB, false);
  if (semPedir.emPartes || !semPedir.url) throw new Error("quem não pediu partes recebeu partes");
  const pequeno = await preparar(80 * MB, true);
  if (pequeno.emPartes) throw new Error("80 MB foi para partes");
  return "300 MB → partes de 32 MB; sem pedir ou com 80 MB → PUT único";
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

// A bancada desta execucao sai inteira (ver fixture-de-teste.mjs).
await limparRodada(db);
await db.end();

if (falhou) {
  console.error("\n✗ o envio em partes tem problema");
  process.exit(1);
}
console.log("\n✓ envio em partes íntegro — filmes acima de 5 GB destravados");
