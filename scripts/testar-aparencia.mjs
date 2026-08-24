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

// Os testes abaixo publicam galeria, removem senha e apagam midia.
exigirBancoDeTeste();

const BASE = process.env.BASE_URL ?? "http://localhost:3040";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const { rows } = await db.query(
  `select g.id, g.slug gslug, t.slug tslug
     from galerias g join tenants t on t.id = g.tenant_id
    order by g.criado_em limit 1`,
);
const { id: galeriaId, gslug, tslug } = rows[0];
const url = `${BASE}/g/${tslug}/${gslug}`;
await db.query("update galerias set publicada = true, senha_hash = null where id = $1", [galeriaId]);

const PRESETS = {
  olumier: { capa: "imersa", tema: "noite", tipografia: "serifada", grade: "editorial", densidade: "normal" },
  revista: { capa: "jornal", tema: "claro", tipografia: "serifada", grade: "colunas", densidade: "normal" },
  atelie: { capa: "dividida", tema: "creme", tipografia: "manuscrita", grade: "linhas", densidade: "arejada" },
  essencial: { capa: "minima", tema: "claro", tipografia: "moderna", grade: "quadrada", densidade: "compacta" },
};

// Assinaturas: o que precisa aparecer no HTML de cada combinação.
const FUNDO = { noite: "#0d0b09", claro: "#ffffff", creme: "#fbf8f2" };
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
await db.end();

if (falhou) {
  console.error("\n✗ o sistema de aparência tem problema");
  process.exit(1);
}
console.log(`\n✓ aparência funcionando — deixei no preset "Revista" em ${url}`);
