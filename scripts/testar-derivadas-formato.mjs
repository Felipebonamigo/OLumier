#!/usr/bin/env node
/**
 * O formato das derivadas deixa de ser WEBP cravado. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-derivadas-formato.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── POR QUE ISTO PRECISOU MUDAR ────────────────────────────────────────────
 * A miniatura e a prévia nascem no `canvas` do navegador, em WEBP, e o formato
 * estava gravado em DOIS lugares: a extensão na chave do objeto (`montarChaves`)
 * e o Content-Type da URL assinada. Enquanto só o navegador enviasse, tanto fazia.
 *
 * O Lightroom Classic exporta JPEG, JPEG XL, AVIF, PSD, TIFF, PNG e DNG — e
 * **não exporta WEBP**. Um plugin que mandasse AVIF gravaria bytes AVIF numa
 * chave terminada em `.webp`, assinada como `image/webp`: o objeto sobe, a
 * galeria serve o Content-Type errado, e o navegador do casal decide sozinho se
 * exibe ou não. Defeito que aparece na entrega, não no teste.
 *
 * O AVIF é bom para nós, aliás: comprime igual ou melhor que WEBP e é lido por
 * todo navegador atual. O problema nunca foi o formato — era ele estar cravado.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { cookieDeSessao } from "./sessao-de-teste.mjs";
import { gerarChave } from "../src/lib/chaves-api.ts";
import { conferirObjeto } from "../src/lib/r2.ts";

await exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let falhou = false;
async function etapa(nome, fn) {
  try {
    const d = await fn();
    console.log(`  ✓ ${nome}${d ? ` — ${d}` : ""}`);
  } catch (e) {
    falhou = true;
    console.log(`  ✗ ${nome} — ${e.message}`);
  }
}
const igual = (a, b, o) => {
  if (a !== b) throw new Error(`${o}: esperava ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};

const { rows: gs } = await db.query(
  "select id, tenant_id from galerias where estado = 'online' order by criado_em limit 1",
);
if (gs.length === 0) {
  console.error("✗ sem galeria online no banco de teste");
  process.exit(1);
}
const galeria = gs[0];
const cookie = cookieDeSessao(galeria.tenant_id);
const chave = (await gerarChave(galeria.tenant_id, "formato derivadas", "envio")).segredo;

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const bytesDerivada = Buffer.alloc(32, 7);

const preparar = (corpo) =>
  fetch(`${BASE}/api/galerias/${galeria.id}/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${chave}`, "content-type": "application/json" },
    body: JSON.stringify({ nome: "formato.png", mime: "image/png", bytes: png.length, ...corpo }),
  });

const criadas = [];
const limpar = (id) =>
  fetch(`${BASE}/api/medias/${id}/confirmar`, { method: "DELETE", headers: { cookie } });

console.log("\nFormato das derivadas\n");

await etapa("sem pedir formato, continua WEBP — o navegador não muda", async () => {
  const r = await preparar({ comDerivadas: true });
  const p = await r.json();
  if (!r.ok) throw new Error(p.erro ?? `HTTP ${r.status}`);
  criadas.push(p.mediaId);

  const { rows } = await db.query(
    "select chave_thumb, chave_preview from medias where id = $1",
    [p.mediaId],
  );
  if (!rows[0].chave_thumb.endsWith("_thumb.webp")) {
    throw new Error(`thumb: ${rows[0].chave_thumb}`);
  }
  if (!rows[0].chave_preview.endsWith("_prev.webp")) {
    throw new Error(`preview: ${rows[0].chave_preview}`);
  }
  return "_thumb.webp e _prev.webp";
});

let mediaAvif = null;

await etapa("pedindo AVIF, a chave nasce .avif", async () => {
  const r = await preparar({ comDerivadas: true, formatoDerivadas: "avif" });
  const p = await r.json();
  if (!r.ok) throw new Error(p.erro ?? `HTTP ${r.status}`);
  mediaAvif = p.mediaId;
  criadas.push(p.mediaId);

  const { rows } = await db.query(
    "select chave_thumb, chave_preview from medias where id = $1",
    [p.mediaId],
  );
  if (!rows[0].chave_thumb.endsWith("_thumb.avif")) throw new Error(`thumb: ${rows[0].chave_thumb}`);
  if (!rows[0].chave_preview.endsWith("_prev.avif")) throw new Error(`preview: ${rows[0].chave_preview}`);

  /* A URL assinada tem de aceitar o Content-Type do formato pedido: assinatura
   * feita com `image/webp` recusa um PUT que declara `image/avif`, e o defeito
   * só apareceria no envio de verdade. */
  const envio = await fetch(p.urlThumb, {
    method: "PUT",
    headers: { "Content-Type": "image/avif" },
    body: bytesDerivada,
  });
  if (!envio.ok) throw new Error(`PUT da miniatura AVIF: HTTP ${envio.status}`);

  const obj = await conferirObjeto(rows[0].chave_thumb);
  igual(obj.mime, "image/avif", "Content-Type gravado");
  return "chave .avif e objeto servido como image/avif";
});

await etapa("pedindo JPEG, a chave nasce .jpg", async () => {
  const r = await preparar({ comDerivadas: true, formatoDerivadas: "jpeg" });
  const p = await r.json();
  if (!r.ok) throw new Error(p.erro ?? `HTTP ${r.status}`);
  criadas.push(p.mediaId);
  const { rows } = await db.query("select chave_thumb from medias where id = $1", [p.mediaId]);
  if (!rows[0].chave_thumb.endsWith("_thumb.jpg")) throw new Error(`thumb: ${rows[0].chave_thumb}`);
  return "_thumb.jpg";
});

await etapa("formato inventado é RECUSADO, não vira o padrão em silêncio", async () => {
  const r = await preparar({ comDerivadas: true, formatoDerivadas: "bmp" });
  igual(r.status, 415, "status");
  /* Cair no padrão calado faria o plugin achar que mandou BMP e receber uma
   * chave .webp — e só descobrir isso na galeria do cliente. */
});

await etapa("republicar respeita o formato gravado na chave", async () => {
  /* A mídia AVIF precisa estar pronta para ser republicável. */
  await fetch(`${BASE}/api/medias/${mediaAvif}/confirmar`, {
    method: "PUT",
    headers: { authorization: `Bearer ${chave}` },
  }).catch(() => {});
  const envioOriginal = await preparar({});
  const po = await envioOriginal.json();
  criadas.push(po.mediaId);
  await fetch(po.url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
  await fetch(`${BASE}/api/medias/${po.mediaId}/confirmar`, {
    method: "POST",
    headers: { authorization: `Bearer ${chave}` },
  });

  const r = await fetch(`${BASE}/api/medias/${mediaAvif}/arquivo`, {
    method: "PUT",
    headers: { authorization: `Bearer ${chave}`, "content-type": "application/json" },
    body: JSON.stringify({ bytes: png.length, comDerivadas: true }),
  });
  const p = await r.json();
  /* A mídia AVIF nunca foi confirmada (o original não subiu), então 409 é o
   * esperado — o que este passo prova é que a rota não estoura e não inventa
   * formato. O caminho feliz do formato já está preso nos passos acima. */
  if (r.status !== 409 && r.status !== 200) {
    throw new Error(`status inesperado ${r.status}: ${p.erro ?? ""}`);
  }
  return `HTTP ${r.status}, sem inventar formato`;
});

for (const id of criadas) await limpar(id);
await db.query("delete from chaves_api where tenant_id = $1 and nome = 'formato derivadas'", [
  galeria.tenant_id,
]);
await db.end();

console.log(falhou ? "\n✗ formato das derivadas com falha\n" : "\n✓ formato das derivadas ok\n");
process.exit(falhou ? 1 : 0);
