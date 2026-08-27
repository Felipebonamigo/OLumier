#!/usr/bin/env node
/**
 * O que um mecanismo de busca (e o WhatsApp) encontra no site.
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-seo.mjs
 *
 * Nasceu da auditoria de 27/08/2026 (skill seo-audit), que achou quatro furos
 * num site tecnicamente rápido: sem sitemap, sem robots, sem Open Graph e sem
 * dados estruturados. Nenhum teste acusava, porque nenhum teste perguntava.
 *
 * O furo que mais dói no nosso mercado é o terceiro: fotógrafo compartilha
 * link por WHATSAPP, e link sem Open Graph aparece pelado — sem imagem, sem
 * título formatado. A página de venda perde exatamente onde ela circula.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3040";
import { marca } from "../src/config/marca.ts";

let falhou = false;
const etapa = async (nome, fn) => {
  try {
    const extra = await fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    falhou = true;
    console.error(`  ✗ ${nome} — ${e.message}`);
  }
};

const pegar = async (caminho) => {
  const r = await fetch(BASE + caminho, { headers: { connection: "close" } });
  return { status: r.status, corpo: await r.text() };
};

console.log("SEO: o que o robô encontra\n");

await etapa("robots.txt existe e aponta o sitemap", async () => {
  const r = await pegar("/robots.txt");
  if (r.status !== 200) throw new Error(`HTTP ${r.status} — robô nenhum sabe o que pode`);
  if (!/sitemap:/i.test(r.corpo)) throw new Error("sem a linha Sitemap: — o robô não descobre o mapa");
  return "com Sitemap:";
});

await etapa("robots.txt fecha o painel e a API", async () => {
  /* Página de ferramenta logada não tem o que fazer no índice do Google. */
  const r = await pegar("/robots.txt");
  if (!r.corpo.includes("/painel")) throw new Error("o /painel ficou aberto para indexação");
  if (!r.corpo.includes("/api")) throw new Error("a /api ficou aberta para indexação");
});

await etapa("sitemap.xml lista as páginas públicas no domínio canônico", async () => {
  const r = await pegar("/sitemap.xml");
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  if (!r.corpo.includes("<urlset")) throw new Error("não é um sitemap XML");
  for (const precisa of [`https://${marca.dominio}`, "/seguranca", "/termos", "/privacidade"]) {
    if (!r.corpo.includes(precisa)) throw new Error(`não lista ${precisa}`);
  }
  /* Página de login não é conteúdo: sitemap só carrega o que merece ranquear. */
  if (r.corpo.includes("/entrar")) throw new Error("lista /entrar — sitemap não é menu");
  return `domínio ${marca.dominio}`;
});

await etapa("a home tem Open Graph completo", async () => {
  const r = await pegar("/");
  for (const p of ["og:title", "og:description", "og:image", "og:url"]) {
    if (!r.corpo.includes(`property="${p}"`)) throw new Error(`sem ${p} — link pelado no WhatsApp`);
  }
  if (!r.corpo.includes('name="twitter:card"')) throw new Error("sem twitter:card");
});

await etapa("a imagem do Open Graph é absoluta e responde", async () => {
  /* WhatsApp e afins não resolvem caminho relativo: sem metadataBase a tag até
   * existe e a prévia continua sem imagem — o pior estado, porque parece feito. */
  const r = await pegar("/");
  const m = r.corpo.match(/property="og:image"[^>]*content="([^"]+)"/);
  if (!m) throw new Error("og:image sumiu");
  if (!m[1].startsWith("http")) throw new Error(`og:image relativa: ${m[1]}`);
  const url = new URL(m[1]);
  const img = await fetch(BASE + url.pathname, { headers: { connection: "close" } });
  if (img.status !== 200) throw new Error(`a imagem devolve HTTP ${img.status}`);
  const tipo = img.headers.get("content-type") ?? "";
  if (!tipo.startsWith("image/")) throw new Error(`content-type ${tipo} — não é imagem`);
  return `${url.pathname} (${tipo})`;
});

console.log(falhou ? "\n✗ o robô encontra menos do que devia" : "\n✓ seo ok");
process.exitCode = falhou ? 1 : 0;
