#!/usr/bin/env node
/**
 * A ROLAGEM QUE NÃO TERMINA. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-rolagem-infinita.mjs
 *
 * ── O PEDIDO (16/09/2026) ─────────────────────────────────────────────────
 *
 * Felipe: "remover paginação dentro do mesmo capítulo, tem apenas que rolar até
 * o final".
 *
 * A paginação nasceu de um defeito real, em 11/09: a galeria da Ana & Kaio, com
 * 2108 fotos, dava 6,35 MB de DOCUMENTO e o Safari do iPhone estourava. O corte
 * em `FOTOS_POR_TELA` resolveu aquilo e trouxe "parte 3 de 4".
 *
 * ── POR QUE ISTO NÃO TRAZ O DEFEITO DE VOLTA ──────────────────────────────
 *
 * Porque o que estourava era o DOCUMENTO. Cada foto custava ~3,2 KB de HTML
 * porque a URL assinada vinha escrita ali dentro. A rota `mais` entrega JSON,
 * lido e descartado: a página continua nascendo com uma tela de fotos, e as
 * seguintes viram nós do DOM sem passar pelo documento. A primeira etapa abaixo
 * é a que guarda isso.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import { FOTOS_POR_TELA } from "../src/config/fatia-galeria.ts";

exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

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

const ALEM = 150;
const TOTAL = FOTOS_POR_TELA + ALEM;

const g = await galeriaDaRodada(db, { nome: "rolagem", medias: 0, publicada: true });
await db.query("update galerias set senha_hash = null where id = $1", [g.id]);
await db.query("delete from medias where galeria_id = $1", [g.id]);

/* Uma inserção só: 750 idas ao banco levariam mais que o teste inteiro. */
const linhas = Array.from({ length: TOTAL }, (_, i) =>
  `('${g.id}','${g.estudio.id}','x/${g.id}/${i}.jpg','x/${g.id}/${i}_thumb.webp','foto-${i}.jpg','foto','image/jpeg',1000,1200,1200,${i},true)`,
);
await db.query(
  `insert into medias (galeria_id, tenant_id, chave, chave_thumb, nome_original, tipo, mime,
                       bytes, largura, altura, ordem, pronto)
   values ${linhas.join(",")}`,
);

const url = `${BASE}/g/${g.tslug}/${g.gslug}`;

console.log("\nA rolagem da galeria grande:\n");

await etapa("a página continua trazendo UMA tela de fotos, não a galeria inteira", async () => {
  const html = await (await fetch(url, { cache: "no-store" })).text();
  const distintas = new Set(html.match(/foto-\d+\.jpg/g) ?? []).size;
  if (distintas > FOTOS_POR_TELA) {
    throw new Error(`${distintas} fotos no documento — é o defeito de 11/09 de volta`);
  }
  if (distintas === 0) throw new Error("não veio foto nenhuma");
  return `${distintas} de ${TOTAL} no documento`;
});

await etapa("a paginação SUMIU da página", async () => {
  const html = await (await fetch(url, { cache: "no-store" })).text();
  if (/parte \d+ de \d+/i.test(html)) throw new Error('ainda existe "parte N de N"');
  if (/próxima parte/i.test(html)) throw new Error('ainda existe "próxima parte"');
  return "sem pastilhas de parte";
});

await etapa("a rota devolve o pedaço seguinte", async () => {
  const r = await fetch(`${BASE}/api/g/${g.id}/mais?desde=${FOTOS_POR_TELA}`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (d.fotos.length === 0) throw new Error("veio vazio");
  /* As fotos têm de ser as SEGUINTES, não as mesmas: repetir o primeiro pedaço
     faria a galeria mostrar a foto 1 de novo no meio da rolagem. */
  const nomes = d.fotos.map((f) => f.nome);
  if (nomes.includes("foto-0.jpg")) throw new Error("repetiu o começo da galeria");
  if (!nomes.includes(`foto-${FOTOS_POR_TELA}.jpg`)) {
    throw new Error(`o pedaço não começa onde o anterior parou: ${nomes[0]}`);
  }
  return `${d.fotos.length} fotos, ${d.restantes} restantes`;
});

await etapa("a rota assina a miniatura, e traz o que a grade precisa", async () => {
  const d = await (
    await fetch(`${BASE}/api/g/${g.id}/mais?desde=${FOTOS_POR_TELA}`, { cache: "no-store" })
  ).json();
  const f = d.fotos[0];
  for (const campo of ["id", "nome", "tipo", "url", "largura", "altura"]) {
    if (f[campo] === undefined) throw new Error(`faltou "${campo}"`);
  }
  /* Sem `largura`/`altura` a grade não reserva o espaço e a página pula
     enquanto as fotos chegam — o defeito que o mural de 04/09 já resolveu. */
  if (!f.largura || !f.altura) throw new Error("veio sem as medidas da foto");
  if (!/^https?:/.test(f.url)) throw new Error(`url estranha: ${f.url}`);
  return "id, nome, tipo, url, medidas e capítulo";
});

await etapa("rolar até o fim chega na última foto", async () => {
  /* O que o navegador faz, em passos: pede, soma, pede de novo. */
  let tenho = FOTOS_POR_TELA;
  let voltas = 0;
  for (;;) {
    const d = await (
      await fetch(`${BASE}/api/g/${g.id}/mais?desde=${tenho}`, { cache: "no-store" })
    ).json();
    tenho += d.fotos.length;
    voltas++;
    if (d.restantes === 0 || d.fotos.length === 0) break;
    if (voltas > 20) throw new Error("a rolagem não termina — laço infinito de verdade");
  }
  if (tenho !== TOTAL) throw new Error(`parou em ${tenho} de ${TOTAL}`);
  return `${TOTAL} fotos em ${voltas} pedidos`;
});

await etapa("pedir além do fim devolve vazio, e não erro", async () => {
  const d = await (
    await fetch(`${BASE}/api/g/${g.id}/mais?desde=${TOTAL + 500}`, { cache: "no-store" })
  ).json();
  if (d.fotos.length !== 0) throw new Error(`veio ${d.fotos.length} foto(s) do além`);
  if (d.restantes !== 0) throw new Error(`disse que restam ${d.restantes}`);
  return "vazio, restantes 0";
});

/*
 * A RÉGUA É A DA PÁGINA. A rota entrega miniatura assinada da galeria inteira:
 * se ela afrouxar, o link secreto deixa de ser secreto.
 */
await etapa("galeria com senha não entrega o resto sem a senha", async () => {
  await db.query("update galerias set senha_hash = 'x' where id = $1", [g.id]);
  try {
    const r = await fetch(`${BASE}/api/g/${g.id}/mais?desde=0`, { cache: "no-store" });
    if (r.ok) throw new Error(`HTTP ${r.status} — entregou sem a senha`);
    return `HTTP ${r.status}`;
  } finally {
    await db.query("update galerias set senha_hash = null where id = $1", [g.id]);
  }
});

await etapa("galeria fora do ar não entrega o resto", async () => {
  await db.query("update galerias set publicada = false where id = $1", [g.id]);
  try {
    const r = await fetch(`${BASE}/api/g/${g.id}/mais?desde=0`, { cache: "no-store" });
    if (r.ok) throw new Error("entregou com a galeria despublicada");
    return `HTTP ${r.status}`;
  } finally {
    await db.query("update galerias set publicada = true where id = $1", [g.id]);
  }
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ a rolagem infinita tem problema" : "\n✓ rolagem infinita ok");
process.exit(falhou ? 1 : 0);
