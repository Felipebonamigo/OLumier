#!/usr/bin/env node
/**
 * A LISTA DE CAPÍTULOS DIZ O QUE É FOTO E O QUE É VÍDEO (08/10/2026). Uso:
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-contagem-de-midias.mjs
 *
 * Juan, olhando "Vídeos - Júlia e Gustavo — ver as 7 fotos": "tá escrito só
 * 'fotos', poderia descrever o que são fotos e o que são vídeos". O que isto
 * prende:
 *
 *   1. As palavras: só fotos, só vídeos, os dois — no singular e no plural.
 *   2. A CONSULTA: `listarSecoes` separa os vídeos no banco, e a conta nunca
 *      desencontra (vídeos ≤ total).
 *   3. A tela usa a régua, e não escreve "foto"/"fotos" à mão para o capítulo.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { estudioDaRodada, galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

await exigirBancoDeTeste();

const RAIZ = path.resolve(import.meta.dirname, "..");
const { contagemDe, textoDaContagem, textoDoLinkVer, textoDoTirar } = await import("../src/lib/contagem-de-midias.ts");
const { listarSecoes } = await import("../src/lib/secoes.ts");

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
function igual(obtido, esperado) {
  if (obtido !== esperado) throw new Error(`esperava «${esperado}», veio «${obtido}»`);
}

console.log("Lista de capítulos: fotos e vídeos:\n");

await etapa("a contagem separa fotos de vídeos, sem passar do total", () => {
  const a = contagemDe(232, 3);
  if (a.fotos !== 229 || a.videos !== 3) throw new Error(JSON.stringify(a));
  const b = contagemDe(5, 9); // desencontro entre duas consultas
  if (b.fotos !== 0 || b.videos !== 5) throw new Error(`vídeos passaram do total: ${JSON.stringify(b)}`);
  const c = contagemDe(-1, -2);
  if (c.fotos !== 0 || c.videos !== 0) throw new Error(`negativo vazou: ${JSON.stringify(c)}`);
});

await etapa("o texto: só fotos, só vídeos, os dois, singular e vazio", () => {
  igual(textoDaContagem(contagemDe(229, 0)), "229 fotos");
  igual(textoDaContagem(contagemDe(1, 0)), "1 foto");
  igual(textoDaContagem(contagemDe(7, 7)), "7 vídeos");
  igual(textoDaContagem(contagemDe(1, 1)), "1 vídeo");
  igual(textoDaContagem(contagemDe(232, 3)), "229 fotos · 3 vídeos");
  igual(textoDaContagem(contagemDe(0, 0)), "0 fotos");
});

await etapa("o link que abre a grade, com o artigo certo", () => {
  igual(textoDoLinkVer(contagemDe(62, 0)), "ver as 62 fotos");
  igual(textoDoLinkVer(contagemDe(1, 0)), "ver a 1 foto");
  igual(textoDoLinkVer(contagemDe(7, 7)), "ver os 7 vídeos");
  igual(textoDoLinkVer(contagemDe(1, 1)), "ver o 1 vídeo");
  igual(textoDoLinkVer(contagemDe(232, 3)), "ver 229 fotos · 3 vídeos");
});

await etapa("o botão de tirar diz o que sai", () => {
  igual(textoDoTirar(contagemDe(10, 0)), "tirar as fotos");
  igual(textoDoTirar(contagemDe(4, 4)), "tirar os vídeos");
  igual(textoDoTirar(contagemDe(10, 4)), "tirar tudo");
});

/* ── a consulta, no banco ──────────────────────────────────────────────── */
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const estudio = await estudioDaRodada(db);
const galeria = await galeriaDaRodada(db, { nome: "contagem" });

await etapa("listarSecoes separa os vídeos prontos de cada capítulo", async () => {
  const { rows } = await db.query(
    "insert into secoes (galeria_id, nome, slug, ordem) values ($1, 'Festa', 'festa', 0) returning id",
    [galeria.id],
  );
  const secaoId = rows[0].id;
  const nova = (tipo, i, pronto = true) =>
    db.query(
      `insert into medias (galeria_id, tenant_id, chave, nome_original, tipo, mime, bytes, secao_id, ordem, pronto)
       values ($1, $2, $3, $4, $5, $6, 1000, $7, $8, $9)`,
      [
        galeria.id,
        estudio.id,
        `${estudio.id}/${galeria.id}/c${i}-${Date.now()}`,
        `m${i}`,
        tipo,
        tipo === "video" ? "video/mp4" : "image/jpeg",
        secaoId,
        i,
        pronto,
      ],
    );
  await nova("foto", 0);
  await nova("foto", 1);
  await nova("video", 2);
  await nova("video", 3, false); // ainda subindo: não conta, nem como total

  const [s] = await listarSecoes(galeria.id);
  if (s.total !== 3) throw new Error(`total ${s.total}, esperava 3 (2 fotos + 1 vídeo pronto)`);
  if (s.total_videos !== 1) throw new Error(`total_videos ${s.total_videos}, esperava 1`);
  const c = contagemDe(s.total, s.total_videos);
  igual(textoDaContagem(c), "2 fotos · 1 vídeo");
});

await limparRodada(db);
await db.end();

/* ── a tela usa a régua ─────────────────────────────────────────────────── */
await etapa("a lista de capítulos escreve pela régua, não à mão", () => {
  const editor = readFileSync(path.join(RAIZ, "src/components/editor-secoes.tsx"), "utf8");
  if (!editor.includes("contagem-de-midias")) throw new Error("o editor não importa a régua");
  if (editor.includes("ver as {s.total}")) throw new Error('o link do capítulo voltou a dizer "fotos" à mão');
  if (editor.includes("ver as {semCapitulo}")) throw new Error('o link das soltas voltou a dizer "fotos" à mão');
  const pagina = readFileSync(path.join(RAIZ, "src/app/painel/galerias/[id]/fotos/page.tsx"), "utf8");
  if (!pagina.includes("total_videos")) throw new Error("a página não passa os vídeos ao editor");
  if (!pagina.includes("semCapituloVideos")) throw new Error("a página não passa os vídeos das soltas");
});

console.log(falhou ? "\n✗ contagem de fotos e vídeos com falha" : "\n✓ contagem de fotos e vídeos ok");
process.exit(falhou ? 1 : 0);
