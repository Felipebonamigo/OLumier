#!/usr/bin/env node
/**
 * A grossura do título da capa. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/registrar-ts.mjs scripts/testar-peso-titulo.mjs
 *
 * Precisa do servidor de desenvolvimento rodando.
 *
 * ── O DEFEITO QUE ISTO PRENDE (04/09/2026) ─────────────────────────────────
 *
 * O sócio disse "o título tá muito grosso". A causa não era escolha de design:
 * `galeria-capa.tsx` cravava `font-bold` (700) nas quatro capas, e SETE das
 * fontes do catálogo só têm o peso 400 no arquivo — Great Vibes, Parisienne,
 * Petit Formal, Sacramento, Italianno, Marcellus e Tenor Sans.
 *
 * Pedir 700 de uma fonte que só tem 400 não deixa a fonte mais forte: o
 * navegador ENGORDA o traço artificialmente (negrito sintético). Numa
 * manuscrita de casamento isso engrossa a caligrafia e a deforma — é
 * exatamente o que se vê e não se sabe nomear.
 *
 * Por isso a regra principal aqui não é "existe um seletor de grossura", e sim
 * **nunca pedir um peso que a fonte não tem**. O seletor é a segunda parte, e
 * só faz efeito onde há peso de verdade para escolher.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";
import {
  APARENCIA_PADRAO,
  OPCOES,
  PRESETS,
  lerAparencia,
  pesoDoTitulo,
} from "../src/config/aparencia.ts";

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

/*
 * A lista é escrita À MÃO, e não importada de `aparencia.ts`.
 *
 * Importar faria o teste concordar com qualquer mudança — inclusive com alguém
 * marcando uma manuscrita como tendo negrito. Estes sete nomes foram conferidos
 * um a um em `src/app/layout.tsx`, onde o `next/font` declara `weight: "400"`.
 */
const SO_TEM_400 = [
  "manuscrita", // Great Vibes
  "parisienne",
  "petit", // Petit Formal Script
  "sacramento",
  "italianno",
  "marcellus",
  "tenor", // Tenor Sans
];

/* Estas têm peso de verdade — variáveis ou com vários arquivos. */
const TEM_NEGRITO = ["serifada", "playfair", "bodoni", "moderna", "baskerville"];

console.log("\nGrossura do título\n");

await etapa("o eixo existe, com três opções", () => {
  if (!OPCOES.peso || OPCOES.peso.length !== 3) {
    throw new Error(`OPCOES.peso: ${JSON.stringify(OPCOES.peso)}`);
  }
  igual(APARENCIA_PADRAO.peso, "normal", "padrão");
  return OPCOES.peso.map((p) => p.id).join(", ");
});

await etapa("fonte de peso único NUNCA pede negrito — nem escolhendo “forte”", () => {
  for (const fonte of SO_TEM_400) {
    for (const peso of OPCOES.peso.map((p) => p.id)) {
      const w = pesoDoTitulo(fonte, peso);
      if (w !== 400) {
        throw new Error(`${fonte} + ${peso} pediu ${w} — o navegador engordaria o traço`);
      }
    }
  }
  return `${SO_TEM_400.length} fontes travadas em 400`;
});

await etapa("fonte com peso de verdade responde aos três", () => {
  for (const fonte of TEM_NEGRITO) {
    const leve = pesoDoTitulo(fonte, "leve");
    const normal = pesoDoTitulo(fonte, "normal");
    const forte = pesoDoTitulo(fonte, "forte");
    if (!(leve <= normal && normal < forte)) {
      throw new Error(`${fonte}: ${leve}/${normal}/${forte} não é crescente`);
    }
    if (forte < 600) throw new Error(`${fonte}: "forte" deu só ${forte}`);
  }
  return TEM_NEGRITO.map((f) => `${f} ${pesoDoTitulo(f, "forte")}`).join(" · ");
});

await etapa("a fonte ENVIADA pelo estúdio é tratada como peso único", () => {
  /* Não sabemos o que tem dentro do arquivo que o fotógrafo subiu. Pedir 700 de
   * uma fonte desconhecida é a mesma aposta que causou o defeito. */
  for (const peso of OPCOES.peso.map((p) => p.id)) {
    igual(pesoDoTitulo("propria", peso), 400, `propria + ${peso}`);
  }
});

await etapa("lerAparencia valida o peso, e o que não existe cai no padrão", () => {
  igual(lerAparencia({ peso: "forte" }).peso, "forte", "válido");
  igual(lerAparencia({ peso: "grossíssimo" }).peso, "normal", "inventado");
  igual(lerAparencia({}).peso, "normal", "ausente");
});

await etapa("todo preset declara um peso", () => {
  for (const p of PRESETS) {
    if (!OPCOES.peso.some((o) => o.id === p.aparencia.peso)) {
      throw new Error(`preset "${p.nome}" sem peso válido: ${JSON.stringify(p.aparencia.peso)}`);
    }
  }
  return `${PRESETS.length} presets`;
});

// ── a capa de verdade ──────────────────────────────────────────────────────

const g = await galeriaDaRodada(db, { nome: "peso", medias: 2 });

/** O `style` do <h1> da capa, como o navegador do convidado recebe. */
async function estiloDoTitulo(aparencia) {
  await db.query("update galerias set aparencia = $1 where id = $2", [
    JSON.stringify(aparencia),
    g.id,
  ]);
  const html = await (await fetch(`${BASE}/g/${g.tslug}/${g.gslug}`)).text();
  const h1 = html.match(/<h1[^>]*>/);
  if (!h1) throw new Error("não achei o <h1> da capa");
  return h1[0];
}

await etapa("o h1 da capa carrega o peso escolhido", async () => {
  const tag = await estiloDoTitulo({ ...APARENCIA_PADRAO, tipografia: "playfair", peso: "forte" });
  const w = tag.match(/font-weight:\s*(\d+)/);
  if (!w) throw new Error(`h1 sem font-weight: ${tag}`);
  igual(Number(w[1]), 700, "peso");
  return `font-weight:${w[1]}`;
});

await etapa("com fonte de peso único, o h1 NÃO pede 700 nem no forte", async () => {
  const tag = await estiloDoTitulo({ ...APARENCIA_PADRAO, tipografia: "italianno", peso: "forte" });
  const w = tag.match(/font-weight:\s*(\d+)/);
  if (!w) throw new Error(`h1 sem font-weight: ${tag}`);
  igual(Number(w[1]), 400, "peso");
});

await etapa("o título deixou de vir com o negrito cravado na classe", async () => {
  /* `font-bold` na classe vence qualquer `font-weight` do style em especificidade
   * de utilitário? Não — mas ele existia nas QUATRO capas, e enquanto estiver lá
   * o eixo não manda em nada. Este passo é o que impede a volta. */
  const tag = await estiloDoTitulo({ ...APARENCIA_PADRAO, peso: "leve" });
  if (/\bfont-bold\b/.test(tag)) throw new Error(`h1 ainda tem font-bold: ${tag}`);
});

await limparRodada(db);
await db.end();

console.log(falhou ? "\n✗ grossura do título com falha\n" : "\n✓ grossura do título ok\n");
process.exit(falhou ? 1 : 0);
