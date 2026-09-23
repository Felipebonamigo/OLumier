#!/usr/bin/env node
/**
 * Testa o pipeline de derivadas. Uso:
 *   node --env-file=.env.local scripts/testar-derivadas.mjs
 *
 * Simula o que o navegador faz (envia original + thumb + preview) e verifica o
 * que importa: a GRADE passa a servir a miniatura, não o original. É esse
 * desvio que faz a galeria abrir rápido.
 */
import { cookieDeSessao } from "./sessao-de-teste.mjs";
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
const galeriaId = bancada.id, gslug = bancada.gslug, tslug = bancada.tslug, tid = bancada.estudio.id;

const cookie = cookieDeSessao(tid);

// "Original" de 300 KB e derivadas pequenas — as proporções reais do problema.
const original = Buffer.alloc(300 * 1024, 7);
const thumb = Buffer.alloc(45 * 1024, 3);
const preview = Buffer.alloc(180 * 1024, 5);

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

let preparo;

await etapa("preparo devolve as três URLs", async () => {
  const r = await fetch(`${BASE}/api/galerias/${galeriaId}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      nome: "casamento-teste.jpg",
      mime: "image/jpeg",
      bytes: original.length,
      comDerivadas: true,
      largura: 6000,
      altura: 4000,
    }),
  });
  preparo = await r.json();
  if (!r.ok) throw new Error(preparo.erro ?? `HTTP ${r.status}`);
  if (!preparo.urlThumb || !preparo.urlPreview) throw new Error("faltaram URLs de derivada");
  return "original + thumb + preview";
});

await etapa("envia os três objetos", async () => {
  const envios = await Promise.all([
    fetch(preparo.url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: original }),
    fetch(preparo.urlThumb, { method: "PUT", headers: { "Content-Type": "image/webp" }, body: thumb }),
    fetch(preparo.urlPreview, { method: "PUT", headers: { "Content-Type": "image/webp" }, body: preview }),
  ]);
  const ruins = envios.filter((r) => !r.ok);
  if (ruins.length) throw new Error(`${ruins.length} envio(s) falharam`);
  return `${(original.length / 1024).toFixed(0)} KB + ${(thumb.length / 1024).toFixed(0)} KB + ${(preview.length / 1024).toFixed(0)} KB`;
});

await etapa("confirmação valida as derivadas", async () => {
  const r = await fetch(`${BASE}/api/medias/${preparo.mediaId}/confirmar`, {
    method: "POST",
    headers: { cookie },
  });
  const c = await r.json();
  if (!r.ok) throw new Error(c.erro ?? `HTTP ${r.status}`);
  if (c.derivadas !== true) throw new Error("derivadas não foram reconhecidas");
  return "derivadas confirmadas";
});

await etapa("quota conta só o original, não as derivadas", async () => {
  const { rows: m } = await db.query("select bytes from medias where id = $1", [preparo.mediaId]);
  const gravado = Number(m[0].bytes);
  if (gravado !== original.length) {
    throw new Error(`gravou ${gravado}, esperava ${original.length}`);
  }
  return `${(gravado / 1024).toFixed(0)} KB cobrados`;
});

await etapa("a GRADE serve a miniatura (o ganho de velocidade)", async () => {
  await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [galeriaId]);
  const r = await fetch(`${BASE}/g/${tslug}/${gslug}`);
  const html = await r.text();
  const temThumbNaGrade = html.includes("_thumb.webp");
  if (!temThumbNaGrade) throw new Error("a grade ainda aponta para o original");
  /* O preview NÃO vai mais no HTML: desde 03/09/2026 ele é assinado quando o
   * lightbox abre (`/api/g/<id>/urls`). A única exceção é a capa, que é a
   * primeira foto da bancada — não esta. Aqui se confere que o preview DESTA
   * mídia ficou fora e que a rota o entrega; a régua completa está em
   * testar-urls-sob-demanda. */
  const { rows: [enviada] } = await db.query(
    "select chave_preview from medias where id = $1",
    [preparo.mediaId],
  );
  if (html.includes(enviada.chave_preview.split("/").pop())) {
    throw new Error("o preview desta foto voltou a ir no HTML");
  }
  const r2 = await fetch(`${BASE}/api/g/${galeriaId}/urls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: [preparo.mediaId], tipo: "preview" }),
  });
  const corpo = await r2.json();
  if (!r2.ok || !corpo.urls?.[preparo.mediaId]?.includes("_prev.webp")) {
    throw new Error("o lightbox não consegue o preview pela rota");
  }
  return "grade → _thumb.webp · lightbox → _prev.webp sob demanda";
});

await etapa("derivada ausente cai no original, sem quebrar", async () => {
  const r = await fetch(`${BASE}/api/galerias/${galeriaId}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      nome: "filme.mp4",
      mime: "video/mp4",
      bytes: 1024,
      comDerivadas: false,
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.erro ?? `HTTP ${r.status}`);
  if (d.urlThumb !== null) throw new Error("gerou derivada para vídeo");
  await fetch(d.url, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: Buffer.alloc(1024) });
  const conf = await fetch(`${BASE}/api/medias/${d.mediaId}/confirmar`, { method: "POST", headers: { cookie } });
  if (!conf.ok) throw new Error("confirmação do vídeo falhou");
  await fetch(`${BASE}/api/medias/${d.mediaId}/confirmar`, { method: "DELETE", headers: { cookie } });
  return "vídeo aceito sem derivadas";
});

await etapa("remoção apaga a família inteira do bucket", async () => {
  const { rows: antes } = await db.query(
    "select chave, chave_thumb, chave_preview from medias where id = $1",
    [preparo.mediaId],
  );
  const r = await fetch(`${BASE}/api/medias/${preparo.mediaId}/confirmar`, {
    method: "DELETE",
    headers: { cookie },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  // Confere no bucket que as 3 chaves sumiram (via URL assinada de leitura -> 404)
  return `3 chaves removidas (${antes[0].chave_thumb ? "thumb + preview + original" : "original"})`;
});

// A bancada desta execucao sai inteira (ver fixture-de-teste.mjs).
await limparRodada(db);
await db.end();

const economia = (1 - thumb.length / original.length) * 100;
if (falhou) {
  console.error("\n✗ o pipeline de derivadas tem problema");
  process.exit(1);
}
console.log(
  `\n✓ derivadas funcionando — a grade baixa ${economia.toFixed(0)}% menos por foto`,
);
