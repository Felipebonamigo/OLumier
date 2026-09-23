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

await etapa("a FAQ da home existe como dado estruturado, e diz a verdade", async () => {
  /*
   * FAQPage em JSON-LD é o que candidata a home a resultado expandido no
   * Google. A regra (skill fixing-metadata) é uma só: JSON-LD descreve o que a
   * página REALMENTE mostra — por isso a etapa confere que cada pergunta do
   * bloco estruturado também está no HTML visível. Schema que promete o que a
   * página não tem é a receita da penalidade manual.
   */
  const r = await pegar("/");
  const m = r.corpo.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("sem bloco ld+json — a FAQ não vira resultado expandido");
  const dados = JSON.parse(m[1]);
  if (dados["@type"] !== "FAQPage") throw new Error(`@type é ${dados["@type"]}, não FAQPage`);
  const perguntas = dados.mainEntity ?? [];
  if (perguntas.length < 4) throw new Error(`só ${perguntas.length} perguntas no bloco`);
  for (const p of perguntas) {
    if (!r.corpo.includes(p.name)) {
      throw new Error(`o bloco estruturado promete "${p.name}" e a página visível não mostra`);
    }
  }
  return `FAQPage com ${perguntas.length} perguntas, todas visíveis na página`;
});

/*
 * ── O CARTÃO DA GALERIA (31/08/2026) ──────────────────────────────────────
 *
 * O furo era o mesmo do Open Graph da home, um degrau abaixo: a galeria TINHA
 * cartão, mas era o da plataforma. O fotógrafo mandava a entrega do casamento
 * no WhatsApp e o quadro que abria dizia "Galeria Átomo", com a marca do
 * fornecedor dele no lugar da foto do casal.
 *
 * Duas coisas se prendem aqui, e a segunda é a que ninguém lembraria de olhar:
 * que a foto aparece, e que ela NÃO aparece quando a galeria tem senha — o
 * cartão é público, e mostrar a capa de uma galeria trancada entregaria
 * justamente o que a tranca segura.
 */
console.log("\no cartão de cada galeria");

const pg = (await import("pg")).default;
const { exigirBancoDeTeste } = await import("./guarda-producao.mjs");
const { galeriaDaRodada, limparRodada } = await import("./fixture-de-teste.mjs");
exigirBancoDeTeste();

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const g = await galeriaDaRodada(db, { nome: "cartao", medias: 3, publicada: true });
const rotaCartao = `/g/${g.tslug}/${g.gslug}/opengraph-image`;

/* Duas tentativas porque a PRIMEIRA visita a esta rota compila a página no
   servidor de desenvolvimento e busca a foto no bucket — passa do tempo que o
   fetch espera, e a conexão cai antes de o PNG existir. Em produção a rota já
   está compilada; aqui a segunda tentativa pega o trabalho pronto. */
const baixarCartao = async () => {
  let ultima;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const r = await fetch(BASE + rotaCartao, { cache: "no-store" });
      const buf = Buffer.from(await r.arrayBuffer());
      return { status: r.status, tipo: r.headers.get("content-type"), bytes: buf.length, buf };
    } catch (e) {
      ultima = e;
    }
  }
  throw new Error(`a rota do cartão não respondeu: ${ultima?.message ?? "sem motivo"}`);
};

await db.query("update galerias set senha_hash = null where id = $1", [g.id]);
const semSenha = await baixarCartao();

await etapa("a galeria tem cartão próprio, em PNG", () => {
  if (semSenha.status !== 200) throw new Error(`HTTP ${semSenha.status}`);
  if (!semSenha.tipo?.includes("image/png")) throw new Error(`veio ${semSenha.tipo}`);
  /* Assinatura do PNG: 89 50 4E 47. Conferir o cabeçalho, e não só o
     content-type, porque o content-type é promessa e o cabeçalho é o arquivo. */
  if (semSenha.buf.subarray(0, 4).toString("hex") !== "89504e47") {
    throw new Error("o content-type diz PNG mas os bytes não são de PNG");
  }
  return `${Math.round(semSenha.bytes / 1024)} KB`;
});

await etapa("o cartão da página aponta para esta rota", async () => {
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`, { cache: "no-store" })).text();
  if (!html.includes("opengraph-image")) {
    throw new Error("a galeria não declara og:image — o WhatsApp cai no cartão da plataforma");
  }
  return "og:image presente";
});

await etapa("galeria com senha continua devolvendo cartão, sem quebrar", async () => {
  await db.query("update galerias set senha_hash = $1 where id = $2", ["$2b$10$naoimporta", g.id]);
  const comSenha = await baixarCartao();
  await db.query("update galerias set senha_hash = null where id = $1", [g.id]);

  if (comSenha.status !== 200) throw new Error(`HTTP ${comSenha.status}`);
  if (comSenha.buf.subarray(0, 4).toString("hex") !== "89504e47") {
    throw new Error("não veio PNG — o robô desiste e mostra o link pelado");
  }
  return `${Math.round(comSenha.bytes / 1024)} KB`;
});

/*
 * ── O LIMITE DESTA SUÍTE, DITO EM VOZ ALTA ────────────────────────────────
 *
 * A etapa acima prova que a galeria trancada devolve um cartão válido, e NÃO
 * que a capa some dele. Provar isso de verdade exigiria comparar os dois PNGs,
 * e para isso a bancada precisaria de uma foto DE VERDADE no balde — as chaves
 * do fixture apontam para objetos que nunca foram enviados, então os dois
 * cartões saem iguais (o quadro neutro) e a comparação passaria verde sem
 * medir nada.
 *
 * Escrever um objeto no balde a partir do teste foi descartado: o R2 de
 * desenvolvimento é o MESMO de produção. Um teste que escreve lá é um teste que
 * um dia apaga lá.
 *
 * Sobra prender a regra no código, que é honesto sobre o que está sendo
 * medido: o módulo tem de consultar `senha_hash` ANTES de decidir mostrar a
 * capa. Some essa linha e esta etapa cai.
 */
/*
 * ── O VÉU PRECISA TER TAMANHO ─────────────────────────────────────────────
 *
 * O véu escurece a faixa onde o texto do cartão mora. Ele foi escrito com
 * `position: absolute; inset: 0` — que em navegador resolve o tamanho sozinho —
 * e no satori, que é quem desenha aqui, ficou com tamanho ZERO. Resultado: o
 * véu nunca foi pintado, o cartão saiu com o texto direto sobre a foto, e
 * ninguém percebeu por duas publicações porque a capa do banco de
 * desenvolvimento é escura e o texto lia de qualquer jeito.
 *
 * Só apareceu na primeira galeria real, e mesmo ali só depois de MEDIR a
 * luminância — a olho o texto parecia aceitável. A <img> ao lado sempre
 * funcionou porque já trazia `width` e `height`, e foi o que escondeu o defeito.
 *
 * A etapa é estática porque a alternativa (decodificar o PNG e medir a faixa)
 * exigiria uma dependência de imagem só para isto. O que ela prende é
 * exatamente o erro cometido: absoluto sem medida.
 */
await etapa("o véu do cartão tem largura e altura declaradas", async () => {
  const { readFileSync } = await import("node:fs");
  const path = (await import("node:path")).default;
  const RAIZ = path.resolve(import.meta.dirname, "..");
  const fonte = readFileSync(
    path.join(RAIZ, "src/app/g/[estudio]/[galeria]/opengraph-image.tsx"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  /* Todo bloco de estilo com `position: "absolute"` precisa trazer as duas
     medidas. Vale para o véu e para a foto — os dois são absolutos, e o mesmo
     esquecimento em qualquer um deles apaga a peça em silêncio. */
  const absolutos = [...fonte.matchAll(/style=\{\{([^}]*position:\s*"absolute"[^}]*)\}\}/g)];
  if (absolutos.length < 2) {
    throw new Error(`achei ${absolutos.length} elementos absolutos, esperava ao menos 2 (foto e véu)`);
  }
  for (const [, corpo] of absolutos) {
    if (!/width:/.test(corpo) || !/height:/.test(corpo)) {
      throw new Error(
        "elemento absoluto sem width/height — no satori isso vira tamanho zero e a peça " +
          "some do cartão sem erro nenhum",
      );
    }
  }
  return `${absolutos.length} elementos absolutos, todos com medida`;
});

await etapa("a regra da senha está escrita no gerador do cartão", async () => {
  const { readFileSync } = await import("node:fs");
  const path = (await import("node:path")).default;
  const RAIZ = path.resolve(import.meta.dirname, "..");
  const fonte = readFileSync(
    path.join(RAIZ, "src/app/g/[estudio]/[galeria]/opengraph-image.tsx"),
    "utf8",
  );
  const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  if (!/senha_hash/.test(semComentarios)) {
    throw new Error(
      "o gerador do cartão não consulta `senha_hash` — a capa de galeria trancada iria " +
        "para o cartão público, que o robô do WhatsApp guarda e qualquer um encaminha",
    );
  }
  return "consulta senha_hash antes de mostrar a capa";
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ o robô encontra menos do que devia" : "\n✓ seo ok");
process.exitCode = falhou ? 1 : 0;
