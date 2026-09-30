#!/usr/bin/env node
/**
 * Importar o acervo: pasta ou ZIPs → várias galerias (`lib/importacao.ts`). Uso:
 *   node --experimental-strip-types --import ./scripts/registrar-ts.mjs \
 *     scripts/testar-importacao.mjs
 *
 * O cenário real (Felipe, 30/09/2026): o fotógrafo chega de outra plataforma
 * com 80 galerias — numa pasta "Clientes" com uma subpasta por casamento, ou em
 * 80 ZIPs baixados de lá. Ele escolhe tudo de uma vez e espera ver as 80 galerias
 * propostas, com nome e data, e os capítulos de cada uma já lidos.
 *
 * O que prende aqui:
 *
 *   1. QUAL pasta é galeria. Selecionar "Clientes" e arrastar as pastas dos
 *      casamentos juntas dão caminhos diferentes; as duas têm de dar as mesmas
 *      galerias.
 *   2. Os capítulos continuam funcionando DENTRO de cada galeria — é o que
 *      poupa a pessoa de remontar 80 entregas.
 *   3. A data no nome da pasta vira data da galeria, e só quando é data que
 *      existe.
 *   4. ZIP dividido em partes vira UMA galeria.
 */
const imp = await import("../src/lib/importacao.ts");
const { capitulosDaPasta } = await import("../src/lib/capitulos-pasta.ts");

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
const igual = (a, b, oque) => {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error(`${oque}: esperado ${y}, veio ${x}`);
};

/** Um arquivo do disco, como o `<input webkitdirectory>` ou o arrasto entregam. */
const doDisco = (caminho, bytes = 10) => ({
  arquivo: new File([new Uint8Array(bytes)], caminho.split("/").pop(), { type: "image/jpeg" }),
  caminho,
});

/** Uma entrada de ZIP de mentira — só o que `fonteDoZip` usa. */
const doZip = (caminho, tamanho = 10) => ({
  caminho,
  tamanho,
  abrir: async () => new Blob([new Uint8Array(tamanho)]),
});

console.log("Importação do acervo:\n");

/* ── 1. qual pasta é galeria ──────────────────────────────────────────── */

await etapa("pasta selecionada: cada subpasta é uma galeria", () => {
  const f = imp.fontesDaPasta([
    doDisco("Clientes 2025/Ana e Pedro/a.jpg"),
    doDisco("Clientes 2025/Ana e Pedro/b.jpg"),
    doDisco("Clientes 2025/Bia e Caio/c.jpg"),
  ]);
  igual(f.map((x) => x.nomeSugerido), ["Ana e Pedro", "Bia e Caio"], "galerias");
  igual(f[0].itens.map((i) => i.caminho), ["a.jpg", "b.jpg"], "caminho relativo à galeria");
});

await etapa("pastas arrastadas juntas dão as MESMAS galerias", () => {
  const f = imp.fontesDaPasta([
    doDisco("/Ana e Pedro/a.jpg"),
    doDisco("/Bia e Caio/c.jpg"),
  ]);
  igual(f.map((x) => x.nomeSugerido), ["Ana e Pedro", "Bia e Caio"], "galerias");
});

await etapa("arquivo solto na pasta escolhida vira uma galeria com o nome dela", () => {
  const f = imp.fontesDaPasta([
    doDisco("Ensaio Marina/a.jpg"),
    doDisco("Ensaio Marina/b.jpg"),
  ]);
  igual(f.map((x) => x.nomeSugerido), ["Ensaio Marina"], "galerias");
  igual(f[0].itens.length, 2, "arquivos");
});

await etapa("lixo e tipo que não entra na galeria ficam de fora", () => {
  const f = imp.fontesDaPasta([
    doDisco("Clientes/Ana/a.jpg"),
    doDisco("Clientes/Ana/.DS_Store"),
    { arquivo: new File(["x"], "contrato.pdf", { type: "application/pdf" }), caminho: "Clientes/Ana/contrato.pdf" },
  ]);
  igual(f[0].itens.map((i) => i.caminho), ["a.jpg"], "arquivos");
});

await etapa("modo \"uma galeria só\": a pasta de um casamento com capítulos dentro", () => {
  const f = imp.fontesDaPasta(
    [
      doDisco("Casamento Marina/01 Making Of/a.jpg"),
      doDisco("Casamento Marina/02 Cerimônia/b.jpg"),
    ],
    "uma",
  );
  igual(f.map((x) => x.nomeSugerido), ["Casamento Marina"], "uma galeria");
  igual(f[0].itens.map((i) => i.caminho), ["01 Making Of/a.jpg", "02 Cerimônia/b.jpg"], "caminhos");
});

/* ── 2. os capítulos dentro de cada galeria ──────────────────────────── */

await etapa("subpastas da galeria viram capítulos, na ordem do número", () => {
  const f = imp.fontesDaPasta([
    doDisco("Clientes/Ana e Pedro/02 Cerimônia/b.jpg"),
    doDisco("Clientes/Ana e Pedro/01 Making Of/a.jpg"),
    doDisco("Clientes/Ana e Pedro/solta.jpg"),
    doDisco("Clientes/Bia/c.jpg"),
  ]);
  const [ana] = imp.montarGalerias(
    f.map((fonte) => ({ fonte, titulo: fonte.nomeSugerido, data: "", incluir: true })),
  );
  const caps = capitulosDaPasta(ana.itens.map((i) => i.caminho));
  igual(caps.map((c) => c.nome), ["Making Of", "Cerimônia"], "capítulos");
  return "a solta fica sem capítulo, como no envio comum";
});

await etapa("galeria sem subpastas não inventa capítulo", () => {
  const f = imp.fontesDaPasta([doDisco("Clientes/Bia/c.jpg"), doDisco("Clientes/Ana/a.jpg")]);
  const gs = imp.montarGalerias(
    f.map((fonte) => ({ fonte, titulo: fonte.nomeSugerido, data: "", incluir: true })),
  );
  for (const g of gs) igual(capitulosDaPasta(g.itens.map((i) => i.caminho)), [], g.titulo);
});

await etapa("título com barra não quebra o capítulo", () => {
  const f = imp.fontesDaPasta([doDisco("Clientes/Ana/01 Festa/a.jpg")]);
  const [g] = imp.montarGalerias([{ fonte: f[0], titulo: "Ana / Pedro", data: "", incluir: true }]);
  igual(capitulosDaPasta(g.itens.map((i) => i.caminho)).map((c) => c.nome), ["Festa"], "capítulos");
});

/* ── 3. a data no nome ────────────────────────────────────────────────── */

await etapa("data na frente, no fim, com ano primeiro ou dia primeiro", () => {
  igual(imp.nomeEData("2025-03-14 Ana e Pedro"), { nome: "Ana e Pedro", data: "2025-03-14" }, "ano primeiro");
  igual(imp.nomeEData("2025_03_14 - Ana"), { nome: "Ana", data: "2025-03-14" }, "com traço");
  igual(imp.nomeEData("20250314 Ana"), { nome: "Ana", data: "2025-03-14" }, "colada");
  igual(imp.nomeEData("Ana e Pedro 14.03.2025"), { nome: "Ana e Pedro", data: "2025-03-14" }, "no fim");
  igual(imp.nomeEData("14-03-2025_Bia"), { nome: "Bia", data: "2025-03-14" }, "dia primeiro");
});

await etapa("número que não é data fica no nome", () => {
  igual(imp.nomeEData("2025-02-31 Ana"), { nome: "2025-02-31 Ana", data: null }, "31 de fevereiro");
  igual(imp.nomeEData("Casamento 2025"), { nome: "Casamento 2025", data: null }, "só o ano");
  igual(imp.nomeEData("01 Making Of"), { nome: "01 Making Of", data: null }, "número de capítulo");
});

/* ── 4. ZIPs ──────────────────────────────────────────────────────────── */

await etapa("um ZIP é uma galeria, e os sets de dentro são capítulos", () => {
  const f = imp.fonteDoZip("Ana e Pedro.zip", [
    doZip("Ceremony/IMG_1.jpg"),
    doZip("Reception/IMG_2.jpg"),
  ]);
  igual(f.nomeSugerido, "Ana e Pedro", "nome");
  const [g] = imp.montarGalerias([{ fonte: f, titulo: f.nomeSugerido, data: "", incluir: true }]);
  igual(capitulosDaPasta(g.itens.map((i) => i.caminho)).map((c) => c.nome), ["Ceremony", "Reception"], "capítulos");
});

await etapa("a pasta de cima com o nome da coleção não vira capítulo único", () => {
  const f = imp.fonteDoZip("Ana e Pedro.zip", [doZip("Ana e Pedro/IMG_1.jpg"), doZip("Ana e Pedro/IMG_2.jpg")]);
  igual(f.itens.map((i) => i.caminho), ["IMG_1.jpg", "IMG_2.jpg"], "caminhos");
});

await etapa("pasta de cima com os sets embaixo: os sets são os capítulos", () => {
  const f = imp.fonteDoZip("download.zip", [doZip("Coleção/Ceremony/a.jpg"), doZip("Coleção/Party/b.jpg")]);
  igual(f.itens.map((i) => i.caminho), ["Ceremony/a.jpg", "Party/b.jpg"], "caminhos");
});

await etapa("as partes de uma coleção viram UMA galeria", () => {
  igual(imp.nomeDoZip("Ana e Pedro - Part 2 of 3.zip"), "Ana e Pedro", "part n of m");
  igual(imp.nomeDoZip("Ana e Pedro_part1.zip"), "Ana e Pedro", "_part1");
  igual(imp.nomeDoZip("Ana e Pedro (2).zip"), "Ana e Pedro", "(2)");
  igual(imp.nomeDoZip("Ensaio-2.zip"), "Ensaio-2", "o -2 solto fica");

  const p1 = imp.fonteDoZip("Ana e Pedro - Part 1.zip", [doZip("Ceremony/a.jpg", 5)], 0);
  const p2 = imp.fonteDoZip("Ana e Pedro - Part 2.zip", [doZip("Party/b.jpg", 7)], 1);
  const gs = imp.montarGalerias(
    [p1, p2].map((fonte) => ({ fonte, titulo: fonte.nomeSugerido, data: "", incluir: true })),
  );
  igual(gs.length, 1, "galerias");
  igual(gs[0].bytes, 12, "bytes somados");
  igual(capitulosDaPasta(gs[0].itens.map((i) => i.caminho)).map((c) => c.nome), ["Ceremony", "Party"], "capítulos das duas partes");
});

await etapa("arquivo de ZIP não é aberto antes da hora, e sai com nome e tipo", async () => {
  let aberto = 0;
  const f = imp.fonteDoZip("x.zip", [
    { caminho: "IMG_1.HEIC", tamanho: 4, abrir: async () => (aberto++, new Blob([new Uint8Array(4)])) },
  ]);
  if (aberto !== 0) throw new Error("abriu o conteúdo ao montar a lista");
  const it = f.itens[0];
  igual([it.arquivo.name, it.arquivo.type, it.deZip.bytes], ["IMG_1.HEIC", "image/heic", 4], "marcador");
  const real = await it.deZip.abrir();
  igual([real.name, real.size, real.type], ["IMG_1.HEIC", 4, "image/heic"], "conteúdo");
});

/* ── as linhas da tela ────────────────────────────────────────────────── */

await etapa("linha desmarcada ou sem nome não vira galeria; data é opcional", () => {
  const [a, b, c] = imp.fontesDaPasta([
    doDisco("C/Ana/a.jpg"),
    doDisco("C/Bia/b.jpg"),
    doDisco("C/Caio/c.jpg"),
  ]);
  const gs = imp.montarGalerias([
    { fonte: a, titulo: "Ana", data: "2025-01-02", incluir: true },
    { fonte: b, titulo: "Bia", data: "", incluir: false },
    { fonte: c, titulo: "   ", data: "", incluir: true },
  ]);
  igual(gs.map((g) => [g.titulo, g.data]), [["Ana", "2025-01-02"]], "galerias");
});

await etapa("mesmo nome sem acento e sem caixa é a mesma galeria existente", () => {
  const achada = imp.galeriaDeMesmoNome("ana e pedro", [{ id: "1", titulo: "Ana e Pêdro" }]);
  igual(achada?.id, "1", "existente");
});

console.log(falhou ? "\nFALHOU" : "\nOK");
process.exit(falhou ? 1 : 0);
