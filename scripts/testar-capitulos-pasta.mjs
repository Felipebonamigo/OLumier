#!/usr/bin/env node
/**
 * Testa a leitura de capítulos a partir da estrutura de pastas. Uso:
 *   node --env-file=.env.local --experimental-strip-types \
 *     --import ./scripts/registrar-ts.mjs scripts/testar-capitulos-pasta.mjs
 *
 * O cenário real: o fotógrafo exporta o casamento do Lightroom em pastas
 * ("01 Making Of", "02 Cerimônia", "03 Festa"), arrasta a pasta do casamento
 * inteira e espera a galeria sair montada. Hoje as subpastas são só varridas
 * atrás de arquivos e tudo cai no mesmo destino.
 *
 * As três coisas que separam "funciona" de "parece funcionar", e que este
 * arquivo prende:
 *
 *   1. QUAL nível é o capítulo. Selecionar a pasta do casamento dá caminhos
 *      "Casamento/Cerimônia/foto.jpg" — capítulo no nível 1. Arrastar duas
 *      pastas de uma vez dá "Cerimônia/foto.jpg" — capítulo no nível 0. Errar
 *      isso cria um capítulo chamado "Casamento" com tudo dentro, ou nenhum.
 *
 *   2. A ORDEM. O fotógrafo numera as pastas porque a ordem é a narrativa do
 *      casamento. Em ordem alfabética "Cerimônia" vem antes de "Making Of" e a
 *      festa acaba antes da noiva se arrumar.
 *
 *   3. Não duplicar capítulo que já existe. Enviar a segunda leva de fotos não
 *      pode criar um segundo "Cerimônia" — e "Making Of" e "Making of" são o
 *      mesmo capítulo para quem lê, ainda que não para o `===`.
 */
const mod = await import("../src/lib/capitulos-pasta.ts");

let falhou = false;
const etapa = (nome, fn) => {
  try {
    const extra = fn();
    console.log(`  ✓ ${nome}${extra ? ` — ${extra}` : ""}`);
  } catch (e) {
    console.error(`  ✗ ${nome} — ${e.message}`);
    falhou = true;
  }
};

const igual = (a, b, oque) => {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error(`${oque}: esperado ${y}, veio ${x}`);
};

console.log("Capítulos pela pasta:\n");

/* ── 1. qual nível é o capítulo ─────────────────────────────────────────── */

etapa("pasta do casamento selecionada: capítulo é o nível de baixo", () => {
  const r = mod.capitulosDaPasta([
    "Casamento Marina/01 Making Of/a.jpg",
    "Casamento Marina/01 Making Of/b.jpg",
    "Casamento Marina/02 Cerimônia/c.jpg",
  ]);
  igual(
    r.map((c) => c.nome),
    ["Making Of", "Cerimônia"],
    "nomes",
  );
  return `${r.length} capítulos`;
});

etapa("duas pastas arrastadas juntas: capítulo é o nível de cima", () => {
  const r = mod.capitulosDaPasta(["Cerimônia/a.jpg", "Cerimônia/b.jpg", "Festa/c.jpg"]);
  igual(
    r.map((c) => c.nome),
    ["Cerimônia", "Festa"],
    "nomes",
  );
});

etapa("arquivos soltos, sem pasta: nenhum capítulo", () => {
  const r = mod.capitulosDaPasta(["a.jpg", "b.jpg"]);
  igual(r, [], "capítulos");
});

etapa("pasta sem subpasta: nenhum capítulo, não inventa um com o nome da pasta", () => {
  const r = mod.capitulosDaPasta(["Casamento Marina/a.jpg", "Casamento Marina/b.jpg"]);
  igual(r, [], "capítulos");
});

etapa("subpasta de subpasta não vira capítulo próprio", () => {
  const r = mod.capitulosDaPasta([
    "Casamento/Cerimônia/a.jpg",
    "Casamento/Cerimônia/Selecionadas/b.jpg",
  ]);
  igual(
    r.map((c) => c.nome),
    ["Cerimônia"],
    "nomes",
  );
  igual(r[0].caminhos.length, 2, "arquivos no capítulo");
});

etapa("foto na raiz junto com subpastas fica fora dos capítulos", () => {
  const r = mod.capitulosDaPasta([
    "Casamento/capa.jpg",
    "Casamento/Cerimônia/a.jpg",
    "Casamento/Festa/b.jpg",
  ]);
  igual(
    r.map((c) => c.nome),
    ["Cerimônia", "Festa"],
    "nomes",
  );
  igual(
    r.flatMap((c) => c.caminhos),
    ["Casamento/Cerimônia/a.jpg", "Casamento/Festa/b.jpg"],
    "arquivos com capítulo",
  );
});

etapa("caminho do arrasto vem com barra na frente e não atrapalha", () => {
  const r = mod.capitulosDaPasta(["/Casamento/Cerimônia/a.jpg", "/Casamento/Festa/b.jpg"]);
  igual(
    r.map((c) => c.nome),
    ["Cerimônia", "Festa"],
    "nomes",
  );
});

etapa("barra invertida do Windows conta como separador", () => {
  const r = mod.capitulosDaPasta(["Casamento\\Cerimônia\\a.jpg", "Casamento\\Festa\\b.jpg"]);
  igual(
    r.map((c) => c.nome),
    ["Cerimônia", "Festa"],
    "nomes",
  );
});

/* ── 2. a ordem é a narrativa ───────────────────────────────────────────── */

etapa("número na frente da pasta define a ordem, e sai do nome", () => {
  const r = mod.capitulosDaPasta([
    "C/03 Festa/c.jpg",
    "C/01 Making Of/a.jpg",
    "C/02 Cerimônia/b.jpg",
  ]);
  igual(
    r.map((c) => c.nome),
    ["Making Of", "Cerimônia", "Festa"],
    "ordem",
  );
});

etapa("aceita as formas que o fotógrafo usa de verdade", () => {
  const r = mod.capitulosDaPasta([
    "C/2 - Cerimônia/b.jpg",
    "C/1. Making Of/a.jpg",
    "C/03_Festa/c.jpg",
  ]);
  igual(
    r.map((c) => c.nome),
    ["Making Of", "Cerimônia", "Festa"],
    "ordem",
  );
});

etapa("sem número, mantém a ordem em que as pastas apareceram", () => {
  const r = mod.capitulosDaPasta(["C/Festa/c.jpg", "C/Making Of/a.jpg", "C/Cerimônia/b.jpg"]);
  igual(
    r.map((c) => c.nome),
    ["Festa", "Making Of", "Cerimônia"],
    "ordem",
  );
});

etapa("numeradas vêm antes das sem número", () => {
  const r = mod.capitulosDaPasta(["C/Extras/x.jpg", "C/01 Cerimônia/a.jpg"]);
  igual(
    r.map((c) => c.nome),
    ["Cerimônia", "Extras"],
    "ordem",
  );
});

etapa("ano na frente não é número de ordem — 2026 não vira capítulo 202", () => {
  const r = mod.capitulosDaPasta(["C/2026 Casamento Marina/a.jpg", "C/01 Cerimônia/b.jpg"]);
  igual(
    r.map((c) => c.nome),
    ["Cerimônia", "2026 Casamento Marina"],
    "nomes",
  );
});

etapa("pasta que é só número não fica sem nome", () => {
  const r = mod.capitulosDaPasta(["C/01/a.jpg", "C/02/b.jpg"]);
  igual(
    r.map((c) => c.nome),
    ["01", "02"],
    "nomes",
  );
});

/* ── 3. não duplicar o que já existe ────────────────────────────────────── */

etapa("capítulo que já existe é reusado, não recriado", () => {
  const existentes = [{ id: "uuid-cerimonia", nome: "Cerimônia" }];
  const r = mod.casarComExistentes(mod.capitulosDaPasta(["C/Cerimônia/a.jpg"]), existentes);
  igual(r[0].id, "uuid-cerimonia", "id reusado");
  igual(r[0].criar, false, "não precisa criar");
});

etapa("maiúscula e acento diferentes são o mesmo capítulo", () => {
  const existentes = [{ id: "uuid-making", nome: "Making Of" }];
  const r = mod.casarComExistentes(mod.capitulosDaPasta(["C/making of/a.jpg"]), existentes);
  igual(r[0].id, "uuid-making", "id reusado apesar do caso");
  igual(r[0].criar, false, "não precisa criar");
});

etapa("capítulo novo vem marcado para criar, sem id", () => {
  const r = mod.casarComExistentes(mod.capitulosDaPasta(["C/Ensaio/a.jpg"]), []);
  igual(r[0].criar, true, "precisa criar");
  igual(r[0].id, null, "ainda sem id");
});

console.log(falhou ? "\n✗ capítulos pela pasta com falha" : "\n✓ capítulos pela pasta ok");
process.exit(falhou ? 1 : 0);
