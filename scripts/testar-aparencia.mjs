#!/usr/bin/env node
/**
 * Testa o sistema de aparência. Uso:
 *   node --env-file=.env.local scripts/testar-aparencia.mjs
 *
 * Grava cada preset no banco e confere que a galeria pública SAI DIFERENTE —
 * cor de fundo, marcas da capa e do layout. Sem isso, "trocar de estilo" pode
 * virar um botão que não faz nada visível.
 */
import pg from "pg";
import { exigirBancoDeTeste } from "./guarda-producao.mjs";
import { galeriaDaRodada, limparRodada } from "./fixture-de-teste.mjs";

// Os testes abaixo publicam galeria, removem senha e apagam midia.
exigirBancoDeTeste();
import { TEMAS, OPCOES, FONTES_TITULO } from "../src/config/aparencia.ts";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dirname, "..");

/* O que cada id ANTIGO tinha de fonte. Escrito à mão de propósito: se saísse de
 * FONTES_TITULO, concordaria com qualquer mudança e não conferiria nada. */
const FONTES_ANTIGAS = {
  serifada: "--font-serif-app",
  moderna: "--font-sans-app",
  manuscrita: "--font-script-app",
};

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

/* Bancada própria desta execução — antes: a galeria mais antiga do banco.
 * Ver fixture-de-teste.mjs. */
const bancada = await galeriaDaRodada(db);
const galeriaId = bancada.id, gslug = bancada.gslug, tslug = bancada.tslug;
const url = `${BASE}/g/${tslug}/${gslug}`;
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [galeriaId]);

const PRESETS = {
  olumier: { capa: "imersa", tema: "noite", tipografia: "serifada", grade: "editorial", densidade: "normal" },
  revista: { capa: "jornal", tema: "claro", tipografia: "serifada", grade: "colunas", densidade: "normal" },
  atelie: { capa: "dividida", tema: "creme", tipografia: "manuscrita", grade: "linhas", densidade: "arejada" },
  essencial: { capa: "minima", tema: "claro", tipografia: "moderna", grade: "quadrada", densidade: "compacta" },
};

// Assinaturas: o que precisa aparecer no HTML de cada combinação.
// Lidos da fonte da verdade: com hex copiado aqui, a troca de paleta de
// 24/08/2026 teria deixado o teste validando as cores antigas para sempre.
const FUNDO = Object.fromEntries(
  Object.entries(TEMAS).map(([nome, vars]) => [nome, vars["--g-fundo"]]),
);
const MARCA_GRADE = {
  colunas: "column-width",
  linhas: "flex-basis",
  quadrada: "aspect-ratio:1 / 1",
  editorial: "grid-auto-rows",
};
const FONTE_ESPERADA = {
  serifada: "--font-serif-app",
  moderna: "--font-sans-app",
  manuscrita: "--font-script-app",
};

let falhou = false;
const vistos = new Map();

for (const [nome, ap] of Object.entries(PRESETS)) {
  await db.query("update galerias set aparencia = $1 where id = $2", [JSON.stringify(ap), galeriaId]);
  const r = await fetch(url, { cache: "no-store" });
  const html = (await r.text()).replaceAll("&quot;", '"').replaceAll("\\", "");
  const normalizado = html.replace(/\s+/g, "");

  const checagens = [
    [`fundo ${ap.tema}`, normalizado.includes(FUNDO[ap.tema].replace("#", "")) || html.includes(FUNDO[ap.tema])],
    [`grade ${ap.grade}`, normalizado.includes(MARCA_GRADE[ap.grade].replace(/\s/g, ""))],
    [
      `capa ${ap.capa}`,
      ap.capa === "jornal" ? html.includes("Ver galeria") : !html.includes("Ver galeria"),
    ],
    // O título tem que apontar para a variável do next/font. Já falhou uma vez:
    // usando o token do Tailwind (--font-serif), a variável não existe em tempo
    // de execução e o título cai silenciosamente na fonte do sistema.
    [`fonte ${ap.tipografia}`, normalizado.includes(FONTE_ESPERADA[ap.tipografia])],
  ];

  const ruins = checagens.filter(([, ok]) => !ok).map(([n]) => n);
  if (ruins.length) {
    console.error(`  ✗ preset "${nome}" — não aplicou: ${ruins.join(", ")}`);
    falhou = true;
  } else {
    console.log(`  ✓ preset "${nome}" — ${ap.tema} · capa ${ap.capa} · grade ${ap.grade}`);
  }

  // Guarda uma impressão digital para provar que os presets diferem entre si.
  vistos.set(nome, normalizado.length + "|" + (normalizado.match(/columnWidth|flexBasis|gridAutoRows|aspectRatio/g) || []).join(","));
}

// Presets diferentes têm que gerar HTML diferente — senão a escolha é decorativa.
const impressoes = new Set(vistos.values());
if (impressoes.size < 3) {
  console.error(`  ✗ os presets estão gerando páginas parecidas demais (${impressoes.size} variações)`);
  falhou = true;
} else {
  console.log(`  ✓ os ${vistos.size} presets geram páginas distintas (${impressoes.size} variações)`);
}

/*
 * ── AS FONTES ─────────────────────────────────────────────────────────────
 *
 * O eixo de tipografia deixou de ser três CATEGORIAS e passou a ser uma lista
 * de fontes com nome. Duas coisas podem quebrar em silêncio nessa expansão, e
 * as duas custam caro:
 *
 *   1. Um id antigo mudar de fonte. `serifada`, `moderna` e `manuscrita` estão
 *      gravados em galerias que já foram ENTREGUES. Se um deles passar a
 *      apontar para outra fonte, a galeria do casal muda de cara sozinha, sem
 *      ninguém ter tocado nela.
 *
 *   2. Uma fonte nova não ter variável. `FONTES_TITULO` pode listar uma fonte
 *      que o layout não carregou — a página não quebra, o título só cai na
 *      fonte do sistema. O fotógrafo escolhe "Playfair", vê Arial, e conclui
 *      que o produto está quebrado.
 */
for (const [id, esperado] of Object.entries(FONTES_ANTIGAS)) {
  const atual = FONTES_TITULO[id];
  if (!atual?.includes(esperado)) {
    console.error(
      `  ✗ o id antigo "${id}" mudou de fonte — galeria já entregue mudaria de cara sozinha`,
    );
    falhou = true;
  }
}
console.log(`  ✓ os ${Object.keys(FONTES_ANTIGAS).length} ids antigos apontam para a mesma fonte`);

const semVariavel = OPCOES.tipografia
  .map((o) => o.id)
  .filter((id) => !/var\(--font-[a-z0-9-]+\)/.test(FONTES_TITULO[id] ?? ""));
if (semVariavel.length) {
  console.error(
    `  ✗ sem variável de fonte: ${semVariavel.join(", ")} — o título cairia na fonte do sistema`,
  );
  falhou = true;
} else {
  console.log(`  ✓ as ${OPCOES.tipografia.length} fontes têm variável declarada`);
}

/* Cada fonte precisa estar CARREGADA, não só nomeada. A prova é o layout: se a
 * variável não aparece lá, o next/font nunca a baixou. */
const layout = readFileSync(path.join(RAIZ, "src/app/layout.tsx"), "utf8");
const naoCarregadas = OPCOES.tipografia
  .map((o) => ({ id: o.id, v: FONTES_TITULO[o.id]?.match(/--font-[a-z0-9-]+/)?.[0] }))
  .filter(({ v }) => v && !layout.includes(v));
if (naoCarregadas.length) {
  console.error(
    `  ✗ variável sem fonte carregada no layout: ${naoCarregadas.map((x) => x.id).join(", ")}`,
  );
  falhou = true;
} else {
  console.log("  ✓ toda fonte oferecida está carregada no layout");
}

/*
 * A galeria do CLIENTE não pode baixar fonte que ela não usa.
 *
 * É o argumento de velocidade do produto inteiro: miniatura de 13 KB contra os
 * megabytes do concorrente. Doze fontes pré-carregadas jogariam isso fora numa
 * linha. `preload: false` faz o navegador buscar só a que for de fato usada —
 * a escolhida. As três originais podem pré-carregar: a interface as usa.
 */
const declaracoes = layout.split(/(?=const \w+ = \w+\(\{)/);
const preloadIndevido = declaracoes
  .filter((d) => /--font-titulo-/.test(d) && !/preload:\s*false/.test(d))
  .map((d) => d.match(/--font-titulo-[a-z0-9-]+/)?.[0]);
if (preloadIndevido.length) {
  console.error(`  ✗ fonte opcional sem preload:false — ${preloadIndevido.join(", ")}`);
  falhou = true;
} else {
  console.log("  ✓ as fontes opcionais não são pré-carregadas na galeria do cliente");
}

// Valor inválido não pode quebrar a página.
await db.query(`update galerias set aparencia = '{"tema":"roxo","grade":"maluca"}'::jsonb where id = $1`, [galeriaId]);
const rInvalido = await fetch(url, { cache: "no-store" });
if (rInvalido.status === 200) {
  console.log("  ✓ aparência inválida cai no padrão sem quebrar");
} else {
  console.error(`  ✗ aparência inválida derrubou a página (HTTP ${rInvalido.status})`);
  falhou = true;
}

// Deixa no preset Revista — o mais parecido com a referência do Sirius.
await db.query("update galerias set aparencia = $1 where id = $2", [
  JSON.stringify(PRESETS.revista),
  galeriaId,
]);
// A bancada desta execucao sai inteira (ver fixture-de-teste.mjs).
await limparRodada(db);
await db.end();

if (falhou) {
  console.error("\n✗ o sistema de aparência tem problema");
  process.exit(1);
}
console.log(`\n✓ aparência funcionando — deixei no preset "Revista" em ${url}`);
