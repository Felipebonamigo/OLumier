#!/usr/bin/env node
/**
 * Mede o que uma galeria realmente baixa ao abrir. Uso:
 *   node scripts/medir-velocidade.mjs <url-da-galeria>
 *
 * Serve para provar (e não só afirmar) que a grade carrega miniaturas, não
 * originais — que é o que faz a galeria abrir rápido no celular do convidado.
 */

const url = process.argv[2] ?? "http://localhost:3040/g/estudio-teste-olumier/ana-pedro";

const resposta = await fetch(url);
if (!resposta.ok) {
  console.error(`✗ galeria respondeu HTTP ${resposta.status}`);
  process.exit(1);
}

// O HTML traz as URLs escapadas (payload do React); desescapa antes de procurar.
const html = (await resposta.text())
  .replaceAll("\\u0026", "&")
  .replaceAll("&amp;", "&")
  .replaceAll('\\"', '"');

const acharUrls = (marca) => {
  const re = new RegExp(`https://galerias[^"'\\s<>\\\\]*${marca}[^"'\\s<>\\\\]*`, "g");
  return [...new Set(html.match(re) ?? [])];
};

const thumbs = acharUrls("_thumb\\.webp");
const previews = acharUrls("_prev\\.webp");
const originais = acharUrls("\\.(jpg|jpeg|png)");

async function medir(urls) {
  let total = 0;
  const tamanhos = [];
  for (const u of urls) {
    const r = await fetch(u);
    if (!r.ok) continue;
    const n = (await r.arrayBuffer()).byteLength;
    total += n;
    tamanhos.push(n);
  }
  return { total, tamanhos };
}

console.log(`galeria: ${url}\n`);
console.log(`miniaturas na grade: ${thumbs.length}`);
console.log(`previews (lightbox):  ${previews.length}`);
console.log(`sem derivada (usam o original): ${originais.length}\n`);

const grade = await medir(thumbs);
const orig = await medir(originais);
const prev = await medir(previews.slice(0, 1));

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

console.log(`GRADE — miniaturas:  ${kb(grade.total)} em ${thumbs.length} foto(s)`);
if (thumbs.length) console.log(`  média por foto:    ${kb(grade.total / thumbs.length)}`);
if (previews.length) console.log(`LIGHTBOX — 1 foto:   ${kb(prev.total)}`);

// Os originais das mesmas fotos servem de comparação honesta.
if (originais.length) {
  console.log(`\nORIGINAIS (só no download): ${kb(orig.total)} em ${originais.length}`);
}

if (thumbs.length && originais.length) {
  const mediaThumb = grade.total / thumbs.length;
  const mediaOrig = orig.total / originais.length;
  if (mediaOrig > mediaThumb) {
    console.log(
      `\n→ a grade baixa ${(100 - (mediaThumb / mediaOrig) * 100).toFixed(0)}% menos por foto`,
    );
  }
}

console.log(
  `\nUma galeria de 600 fotos abriria com ~${((grade.total / Math.max(thumbs.length, 1)) * 600) / 1024 / 1024 < 1 ? "menos de 1" : (((grade.total / Math.max(thumbs.length, 1)) * 600) / 1024 / 1024).toFixed(0)} MB de miniaturas.`,
);
